const COMMANDS: &[&str] = &["speak", "stop"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
