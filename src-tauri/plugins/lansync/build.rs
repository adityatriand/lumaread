const COMMANDS: &[&str] = &["start", "stop", "peers", "send", "respond", "log"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
