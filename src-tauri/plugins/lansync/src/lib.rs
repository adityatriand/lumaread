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
    log: Arc<Mutex<Vec<String>>>,
}

fn clock() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let mut tm = unsafe { std::mem::zeroed::<libc::tm>() };
    unsafe { libc::localtime_r(&secs, &mut tm) };
    format!("{:02}:{:02}:{:02}", tm.tm_hour, tm.tm_min, tm.tm_sec)
}

fn note(log: &Mutex<Vec<String>>, message: impl AsRef<str>) {
    let mut lines = log.lock().unwrap();
    lines.push(format!("{}  {}", clock(), message.as_ref()));
    let extra = lines.len().saturating_sub(80);
    if extra > 0 {
        lines.drain(0..extra);
    }
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

/// Subnet broadcast from the address and mask when the OS does not report one.
/// Android often leaves that field empty, so a phone would only shout at 255.255.255.255, which Wi-Fi drops.
fn directed_broadcast(ip: Ipv4Addr, netmask: Ipv4Addr) -> Option<Ipv4Addr> {
    let mask = u32::from(netmask);
    if mask == 0 || mask == u32::MAX || ip.is_loopback() || ip.is_unspecified() {
        return None;
    }
    let bcast = Ipv4Addr::from(u32::from(ip) | !mask);
    if bcast.is_unspecified() || bcast.is_loopback() || bcast.is_broadcast() {
        return None;
    }
    Some(bcast)
}

// Every IPv4 subnet this machine is on, plus the limited broadcast. macOS often sends
// 255.255.255.255 out the wrong interface (a VPN or bridge), so peers on Wi-Fi never hear it
// and a paired device stays "Not found" with Sync now disabled.
fn announce_targets(port: u16) -> (Vec<SocketAddr>, Vec<String>) {
    let mut targets = vec![SocketAddr::from((Ipv4Addr::BROADCAST, port))];
    let mut lines = Vec::new();
    match if_addrs::get_if_addrs() {
        Ok(list) => {
            for iface in list {
                let if_addrs::IfAddr::V4(v4) = iface.addr else { continue };
                if v4.ip.is_loopback() {
                    continue;
                }
                let bcast = v4.broadcast.filter(|b| !b.is_unspecified() && !b.is_loopback()).or_else(|| directed_broadcast(v4.ip, v4.netmask));
                match bcast {
                    Some(bcast) => {
                        lines.push(format!("{} {} announces to {bcast}", iface.name, v4.ip));
                        targets.push(SocketAddr::from((bcast, port)));
                    }
                    None => lines.push(format!("{} {} has no broadcast address", iface.name, v4.ip)),
                }
            }
        }
        Err(e) => lines.push(format!("Could not list network interfaces: {e}")),
    }
    if lines.is_empty() {
        lines.push("No network interface has an address. This device is not on Wi-Fi.".into());
    }
    targets.sort_unstable();
    targets.dedup();
    (targets, lines)
}

fn permission_hint(error: &io::Error) -> &'static str {
    let denied = error.kind() == io::ErrorKind::PermissionDenied || error.raw_os_error() == Some(1);
    if !denied {
        ""
    } else if cfg!(target_os = "android") {
        " Android is refusing to send on this Wi-Fi."
    } else if cfg!(target_os = "macos") {
        " macOS is blocking Local Network for LumaRead."
    } else {
        ""
    }
}

#[cfg(target_os = "android")]
#[derive(Serialize)]
struct BindWifi {
    fd: i32,
}

/// Pin a socket to Wi-Fi. Android rejects LAN broadcast with EPERM when mobile data is the default network.
#[cfg(target_os = "android")]
fn bind_socket_to_wifi<R: Runtime>(app: &tauri::AppHandle<R>, fd: i32) -> Result<(), String> {
    app.state::<Handle<R>>().0.run_mobile_plugin::<()>("bindWifi", BindWifi { fd }).map_err(|e| e.to_string())
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
    state.log.lock().unwrap().clear();
    note(&state.log, format!("Listening for other devices, tcp {port}"));
    let (targets, lines) = announce_targets(DISCOVERY_PORT);
    for line in lines {
        note(&state.log, line);
    }
    if targets.len() == 1 {
        note(&state.log, "Only the general broadcast is available. A device on Wi-Fi often never hears that.");
    }

    #[cfg(target_os = "android")]
    {
        use std::os::fd::AsRawFd;
        match app.state::<Handle<R>>().0.run_mobile_plugin::<()>("acquire", ()) {
            Ok(()) => note(&state.log, "Holding the multicast lock so Wi-Fi keeps discovery packets"),
            Err(e) => note(&state.log, format!("Could not hold the multicast lock: {e}")),
        }
        match bind_socket_to_wifi(&app, udp.as_raw_fd()) {
            Ok(()) => note(&state.log, "Discovery is using the Wi-Fi network"),
            Err(e) => note(&state.log, format!("Could not attach discovery to Wi-Fi: {e}")),
        }
        if let Err(e) = bind_socket_to_wifi(&app, listener.as_raw_fd()) {
            note(&state.log, format!("Could not attach incoming sync to Wi-Fi: {e}"));
        }
    }

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
        let (run, peers, log) = (run.clone(), state.peers.clone(), state.log.clone());
        let announce = serde_json::json!({ "magic": MAGIC, "id": id, "name": name, "port": port }).to_string();
        thread::spawn(move || {
            let mut last_announce = Instant::now() - Duration::from_secs(10);
            let mut last_direct: HashMap<SocketAddr, Instant> = HashMap::new();
            let mut announced_ok = std::collections::HashSet::new();
            let mut announced_err: HashMap<SocketAddr, (String, Instant)> = HashMap::new();
            let mut last_junk = Instant::now() - Duration::from_secs(30);
            let mut buf = [0u8; 2048];
            while run.load(Ordering::SeqCst) {
                if last_announce.elapsed() >= Duration::from_secs(2) {
                    let (destinations, _) = announce_targets(DISCOVERY_PORT);
                    for dest in destinations {
                        match udp.send_to(announce.as_bytes(), dest) {
                            Ok(_) => {
                                if announced_ok.insert(dest) {
                                    note(&log, format!("Announcing to {dest}"));
                                }
                            }
                            Err(e) => {
                                let msg = e.to_string();
                                let repeat = announced_err.get(&dest).is_some_and(|(prev, at)| prev == &msg && at.elapsed() < Duration::from_secs(15));
                                if !repeat {
                                    note(&log, format!("Could not announce to {dest}: {msg}.{}", permission_hint(&e)));
                                    announced_err.insert(dest, (msg, Instant::now()));
                                }
                            }
                        }
                    }
                    last_announce = Instant::now();
                }
                let Ok((n, from)) = udp.recv_from(&mut buf) else { continue };
                let Ok(v) = serde_json::from_slice::<serde_json::Value>(&buf[..n]) else {
                    if last_junk.elapsed() >= Duration::from_secs(15) {
                        note(&log, format!("Ignored an unreadable packet from {from}"));
                        last_junk = Instant::now();
                    }
                    continue;
                };
                if v["magic"] != MAGIC {
                    if last_junk.elapsed() >= Duration::from_secs(15) {
                        note(&log, format!("Ignored a packet from {from}: not LumaRead"));
                        last_junk = Instant::now();
                    }
                    continue;
                }
                if v["id"] == id.as_str() {
                    continue;
                }
                let (Some(peer_id), Some(peer_name), Some(peer_port)) = (v["id"].as_str(), v["name"].as_str(), v["port"].as_u64()) else {
                    note(&log, format!("Ignored a LumaRead packet from {from}: missing name or port"));
                    continue;
                };
                let peer = Peer { id: peer_id.into(), name: peer_name.chars().take(60).collect(), host: from.ip().to_string(), port: peer_port as u16 };
                let fresh = !peers.lock().unwrap().contains_key(&peer.id);
                if fresh {
                    note(&log, format!("Found {} at {}", peer.name, peer.host));
                }
                peers.lock().unwrap().insert(peer.id.clone(), (peer, Instant::now()));
                // Answer directly. A peer whose broadcast we heard can then see us even when its
                // own broadcast was dropped (common on macOS Wi-Fi).
                let due = last_direct.get(&from).is_none_or(|t| t.elapsed() >= Duration::from_secs(2));
                if due {
                    match udp.send_to(announce.as_bytes(), from) {
                        Ok(_) => {}
                        Err(e) => note(&log, format!("Could not reply to {from}: {e}")),
                    }
                    last_direct.insert(from, Instant::now());
                    last_direct.retain(|_, seen| seen.elapsed() < Duration::from_secs(60));
                }
            }
        });
    }

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
fn log(state: State<'_, Sync>) -> Vec<String> {
    state.log.lock().unwrap().clone()
}

#[tauri::command]
fn peers(state: State<'_, Sync>) -> Vec<Peer> {
    let mut peers = state.peers.lock().unwrap();
    peers.retain(|_, (_, seen)| seen.elapsed() < PEER_TTL);
    peers.values().map(|(p, _)| p.clone()).collect()
}

/// Sends one message to a peer and returns its reply (raw); runs off the main thread (a reply can be a whole book)
fn connect_peer<R: Runtime>(app: &tauri::AppHandle<R>, host: &str, port: u16) -> io::Result<TcpStream> {
    use socket2::{Domain, Socket, Type};
    let socket = Socket::new(Domain::IPV4, Type::STREAM, None)?;
    #[cfg(target_os = "android")]
    {
        use std::os::fd::AsRawFd;
        let _ = bind_socket_to_wifi(app, socket.as_raw_fd());
    }
    #[cfg(not(target_os = "android"))]
    let _ = app;
    let addr = (host, port);
    let std_addr = std::net::ToSocketAddrs::to_socket_addrs(&addr)?.next().ok_or(io::Error::from(io::ErrorKind::NotFound))?;
    let sock_addr = socket2::SockAddr::from(std_addr);
    socket.connect_timeout(&sock_addr, Duration::from_secs(5))?;
    let stream: TcpStream = socket.into();
    stream.set_read_timeout(Some(REPLY_TIMEOUT))?;
    Ok(stream)
}

#[tauri::command]
async fn send<R: Runtime>(app: tauri::AppHandle<R>, host: String, port: u16, data: String) -> Result<Response, String> {
    let data = decode(&data)?;
    tauri::async_runtime::spawn_blocking(move || -> io::Result<Vec<u8>> {
        let mut s = connect_peer(&app, &host, port)?;
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
        .invoke_handler(tauri::generate_handler![start, stop, peers, send, respond, log])
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
        let (targets, _) = announce_targets(9);
        assert!(targets.contains(&SocketAddr::from((Ipv4Addr::BROADCAST, 9))));
        let mut sorted = targets.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(targets, sorted);
    }

    #[test]
    fn subnet_broadcast_is_derived_from_the_mask() {
        assert_eq!(directed_broadcast(Ipv4Addr::new(192, 168, 1, 20), Ipv4Addr::new(255, 255, 255, 0)), Some(Ipv4Addr::new(192, 168, 1, 255)));
        assert_eq!(directed_broadcast(Ipv4Addr::new(10, 1, 2, 3), Ipv4Addr::new(255, 255, 0, 0)), Some(Ipv4Addr::new(10, 1, 255, 255)));
        assert_eq!(directed_broadcast(Ipv4Addr::new(10, 0, 0, 1), Ipv4Addr::new(255, 255, 255, 255)), None);
        assert_eq!(directed_broadcast(Ipv4Addr::new(127, 0, 0, 1), Ipv4Addr::new(255, 0, 0, 0)), None);
    }
}
