//! Wi-Fi sync transport. Finds other LumaRead apps on the same network (UDP broadcast) and carries opaque
//! messages between them over TCP. Pairing, encryption and merging all live in the web app, so nothing here
//! can read what it carries.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{self, Read, Write},
    net::{TcpListener, TcpStream, UdpSocket},
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

// The discovery port can still be held by the previous session's thread for a moment after a restart
fn bind_discovery() -> io::Result<UdpSocket> {
    let mut last = None;
    for _ in 0..20 {
        match UdpSocket::bind(("0.0.0.0", DISCOVERY_PORT)) {
            Ok(s) => return Ok(s),
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
    let udp = bind_discovery().map_err(|e| format!("Sync couldn't listen on this network: {e}"))?;
    udp.set_broadcast(true).map_err(|e| e.to_string())?;
    udp.set_read_timeout(Some(Duration::from_millis(500))).map_err(|e| e.to_string())?;

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
            let mut buf = [0u8; 2048];
            while run.load(Ordering::SeqCst) {
                if last_announce.elapsed() >= Duration::from_secs(2) {
                    let _ = udp.send_to(announce.as_bytes(), ("255.255.255.255", DISCOVERY_PORT));
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
