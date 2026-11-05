//! Wi-Fi sync transport. Finds other LumaRead apps on the same network (UDP broadcast) and carries opaque
//! messages between them over TCP. Pairing, encryption and merging all live in the web app, so nothing here
//! can read what it carries.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{self, Read, Write},
    net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket},
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{
    ipc::{Channel, InvokeResponseBody, Response},
    plugin::{Builder, TauriPlugin},
    Manager, Runtime, State,
};

const DISCOVERY_PORT: u16 = 47_321;
const MAGIC: &str = "lumaread-sync/1";
const MAX_FRAME: usize = 512 * 1024 * 1024; // above the 200 MB import cap plus encryption overhead
const PEER_TTL: Duration = Duration::from_secs(8); // announcements come every 2 s
const REPLY_TIMEOUT: Duration = Duration::from_secs(300); // a large book is read from storage before the reply

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Peer {
    id: String,
    name: String,
    host: String,
    port: u16,
}

#[derive(Default)]
struct Sync {
    running: Mutex<Arc<AtomicBool>>, // the current session's flag; cleared to stop its threads
    peers: Arc<Mutex<HashMap<String, (Peer, Instant)>>>,
    waiting: Arc<Mutex<HashMap<u32, mpsc::Sender<Vec<u8>>>>>, // inbound requests awaiting the web app's reply
    next: Arc<AtomicU32>,
}

fn read_frame(s: &mut TcpStream) -> io::Result<Vec<u8>> {
    let mut len = [0u8; 4];
    s.read_exact(&mut len)?;
    let len = u32::from_be_bytes(len) as usize;
    if len > MAX_FRAME {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "frame too large"));
    }
    let mut buf = vec![0u8; len];
    s.read_exact(&mut buf)?;
    Ok(buf)
}

fn write_frame(s: &mut TcpStream, data: &[u8]) -> io::Result<()> {
    s.write_all(&(data.len() as u32).to_be_bytes())?;
    s.write_all(data)?;
    s.flush()
}

// Bytes from the web app arrive base64-encoded: Android's IPC can't carry a raw request body
// (it turns one into a JSON number array), so one text format serves every platform
fn decode(data: &str) -> Result<Vec<u8>, String> {
    STANDARD.decode(data).map_err(|_| "malformed message".to_string())
}

// One request per connection: hand it to the web app, wait for its reply, send that back
fn serve(mut s: TcpStream, waiting: Arc<Mutex<HashMap<u32, mpsc::Sender<Vec<u8>>>>>, next: Arc<AtomicU32>, channel: Channel) -> io::Result<()> {
    s.set_nonblocking(false)?;
    s.set_read_timeout(Some(Duration::from_secs(60)))?;
    let request = read_frame(&mut s)?;
    let id = next.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = mpsc::channel();
    waiting.lock().unwrap().insert(id, tx);
    let mut message = id.to_be_bytes().to_vec();
    message.extend(request);
    let reply = channel
        .send(InvokeResponseBody::Raw(message))
        .map_err(|e| io::Error::other(e.to_string()))
        .and_then(|_| rx.recv_timeout(REPLY_TIMEOUT).map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "no reply")));
    waiting.lock().unwrap().remove(&id);
    write_frame(&mut s, &reply?)
}

// Every IPv4 subnet this machine is on, plus the limited broadcast. macOS often sends
// 255.255.255.255 out the wrong interface (a VPN or bridge), so peers on Wi-Fi never hear it
// and a paired device stays "Not found" with Sync now disabled.
fn announce_targets(port: u16) -> Vec<SocketAddr> {
    let mut targets = vec![SocketAddr::from((Ipv4Addr::BROADCAST, port))];
    if let Ok(list) = if_addrs::get_if_addrs() {
        for iface in list {
            let if_addrs::IfAddr::V4(v4) = iface.addr else { continue };
            let Some(bcast) = v4.broadcast else { continue };
            if bcast.is_unspecified() || bcast.is_loopback() {
                continue;
            }
            targets.push(SocketAddr::from((bcast, port)));
        }
    }
    targets.sort_unstable();
    targets.dedup();
    targets
}

// The discovery port can still be held by the previous session's thread for a moment after a restart.
// Reuse lets a second copy on this Mac (the installed app and a dev build) hear the same broadcasts.
fn bind_discovery(port: u16) -> io::Result<UdpSocket> {
    use socket2::{Domain, Socket, Type};
    let mut last = None;
    for _ in 0..20 {
        let socket = Socket::new(Domain::IPV4, Type::DGRAM, None)?;
        socket.set_reuse_address(true)?;
        #[cfg(unix)]
        let _ = socket.set_reuse_port(true);
        socket.set_broadcast(true)?;
        match socket.bind(&SocketAddr::from((Ipv4Addr::UNSPECIFIED, port)).into()) {
            Ok(()) => {
                socket.set_read_timeout(Some(Duration::from_millis(500)))?;
                return Ok(UdpSocket::from(socket));
            }
            Err(e) => last = Some(e),
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err(last.unwrap())
}

#[tauri::command]
fn start<R: Runtime>(app: tauri::AppHandle<R>, state: State<'_, Sync>, id: String, name: String, on_request: Channel) -> Result<u16, String> {
    let run = Arc::new(AtomicBool::new(true));
    {
        let mut current = state.running.lock().unwrap();
        current.store(false, Ordering::SeqCst);
        *current = run.clone();
    }
    state.peers.lock().unwrap().clear();

    let listener = TcpListener::bind(("0.0.0.0", 0)).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    listener.set_nonblocking(true).map_err(|e| e.to_string())?; // lets the loop notice a stop
    let udp = bind_discovery(DISCOVERY_PORT).map_err(|e| format!("Sync couldn't listen on this network: {e}"))?;

    {
        let (run, waiting, next) = (run.clone(), state.waiting.clone(), state.next.clone());
        thread::spawn(move || {
            while run.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let (waiting, next, channel) = (waiting.clone(), next.clone(), on_request.clone());
                        thread::spawn(move || serve(stream, waiting, next, channel));
                    }
                    Err(_) => thread::sleep(Duration::from_millis(100)),
                }
            }
        });
    }
    {
        let (run, peers) = (run.clone(), state.peers.clone());
        let announce = serde_json::json!({ "magic": MAGIC, "id": id, "name": name, "port": port }).to_string();
        thread::spawn(move || {
            let mut last_announce = Instant::now() - Duration::from_secs(10);
            let mut last_direct: HashMap<SocketAddr, Instant> = HashMap::new();
            let mut buf = [0u8; 2048];
            while run.load(Ordering::SeqCst) {
                if last_announce.elapsed() >= Duration::from_secs(2) {
                    for dest in announce_targets(DISCOVERY_PORT) {
                        let _ = udp.send_to(announce.as_bytes(), dest);
                    }
                    last_announce = Instant::now();
                }
                let Ok((n, from)) = udp.recv_from(&mut buf) else { continue };
                let Ok(v) = serde_json::from_slice::<serde_json::Value>(&buf[..n]) else { continue };
                if v["magic"] != MAGIC || v["id"] == id.as_str() {
                    continue;
                }
                let (Some(peer_id), Some(peer_name), Some(peer_port)) = (v["id"].as_str(), v["name"].as_str(), v["port"].as_u64()) else { continue };
                let peer = Peer { id: peer_id.into(), name: peer_name.chars().take(60).collect(), host: from.ip().to_string(), port: peer_port as u16 };
                peers.lock().unwrap().insert(peer.id.clone(), (peer, Instant::now()));
                // Answer directly. A peer whose broadcast we heard can then see us even when its
                // own broadcast was dropped (common on macOS Wi-Fi).
                let due = last_direct.get(&from).is_none_or(|t| t.elapsed() >= Duration::from_secs(2));
                if due {
                    let _ = udp.send_to(announce.as_bytes(), from);
                    last_direct.insert(from, Instant::now());
                    last_direct.retain(|_, seen| seen.elapsed() < Duration::from_secs(60));
                }
            }
        });
    }

    #[cfg(target_os = "android")]
    let _ = app.state::<Handle<R>>().0.run_mobile_plugin::<()>("acquire", ());
    #[cfg(not(target_os = "android"))]
    let _ = app;
    Ok(port)
}

#[tauri::command]
fn stop<R: Runtime>(app: tauri::AppHandle<R>, state: State<'_, Sync>) {
    state.running.lock().unwrap().store(false, Ordering::SeqCst);
    state.peers.lock().unwrap().clear();
    #[cfg(target_os = "android")]
    let _ = app.state::<Handle<R>>().0.run_mobile_plugin::<()>("release", ());
    #[cfg(not(target_os = "android"))]
    let _ = app;
}

#[tauri::command]
fn peers(state: State<'_, Sync>) -> Vec<Peer> {
    let mut peers = state.peers.lock().unwrap();
    peers.retain(|_, (_, seen)| seen.elapsed() < PEER_TTL);
    peers.values().map(|(p, _)| p.clone()).collect()
}

/// Sends one message to a peer and returns its reply (raw); runs off the main thread (a reply can be a whole book)
#[tauri::command]
async fn send(host: String, port: u16, data: String) -> Result<Response, String> {
    let data = decode(&data)?;
    tauri::async_runtime::spawn_blocking(move || -> io::Result<Vec<u8>> {
        let addr = (host.as_str(), port);
        let mut s = TcpStream::connect_timeout(&std::net::ToSocketAddrs::to_socket_addrs(&addr)?.next().ok_or(io::ErrorKind::NotFound)?, Duration::from_secs(5))?;
        s.set_read_timeout(Some(REPLY_TIMEOUT))?;
        write_frame(&mut s, &data)?;
        read_frame(&mut s)
    })
    .await
    .map_err(|e| e.to_string())?
    .map(Response::new)
    .map_err(|e| format!("The other device didn't answer: {e}"))
}

/// The web app's reply to an inbound request (id from the 4-byte prefix it was given)
#[tauri::command]
fn respond(state: State<'_, Sync>, id: u32, data: String) -> Result<(), String> {
    let bytes = decode(&data)?;
    if let Some(tx) = state.waiting.lock().unwrap().remove(&id) {
        let _ = tx.send(bytes);
    }
    Ok(())
}

#[cfg(target_os = "android")]
struct Handle<R: Runtime>(tauri::plugin::PluginHandle<R>);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("lansync")
        .invoke_handler(tauri::generate_handler![start, stop, peers, send, respond])
        .setup(|app, _api| {
            app.manage(Sync::default());
            #[cfg(target_os = "android")]
            {
                let handle = _api.register_android_plugin("com.lumaread.lansync", "LanSyncPlugin")?;
                app.manage(Handle(handle));
            }
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn announce_includes_limited_broadcast_once() {
        let targets = announce_targets(9);
        assert!(targets.contains(&SocketAddr::from((Ipv4Addr::BROADCAST, 9))));
        let mut sorted = targets.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(targets, sorted);
    }
}
