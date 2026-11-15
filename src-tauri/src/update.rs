//! Check the `updates` branch, which a local build replaces on each publish.
use serde::Serialize;
use tauri::AppHandle;

const VERSION_URL: &str = "https://raw.githubusercontent.com/adityatriand/lumaread/updates/version.txt";
const FILE_URL: &str = "https://github.com/adityatriand/lumaread/raw/updates";

#[derive(Serialize)]
pub struct UpdateStatus {
    current: String,
    latest: Option<String>,
    available: bool,
    url: Option<String>,
    message: String,
}

fn current() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn parse_version(raw: &str) -> Option<(u32, u32, u32)> {
    let raw = raw.trim().trim_start_matches('v');
    let mut parts = raw.split('.');
    Some((parts.next()?.parse().ok()?, parts.next()?.parse().ok()?, parts.next()?.parse().ok()?))
}

fn asset_name() -> &'static str {
    if cfg!(target_os = "android") {
        "LumaRead-android-arm64.apk"
    } else if cfg!(target_arch = "x86_64") {
        "LumaRead-macos-x64.dmg"
    } else {
        "LumaRead-macos-aarch64.dmg"
    }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("LumaRead")
        .redirect(reqwest::redirect::Policy::limited(20))
        .build()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_update() -> Result<UpdateStatus, String> {
    let current = current();
    let resp = client()?.get(VERSION_URL).send().await.map_err(|e| format!("Couldn't reach updates: {e}"))?;
    if resp.status().as_u16() == 404 {
        return Ok(UpdateStatus {
            current,
            latest: None,
            available: false,
            url: None,
            message: "No update has been published yet.".into(),
        });
    }
    if !resp.status().is_success() {
        return Err(format!("Couldn't check for updates ({})", resp.status()));
    }
    let latest = resp.text().await.map_err(|e| e.to_string())?.lines().next().unwrap_or("").trim().to_string();
    let mine = parse_version(&current);
    let theirs = parse_version(&latest);
    let newer = match (mine, theirs) {
        (Some(a), Some(b)) => b > a,
        _ => false,
    };
    let url = format!("{FILE_URL}/{}", asset_name());
    let message = if newer {
        format!("Version {latest} is ready to install.")
    } else {
        format!("You're on {current}, the latest version.")
    };
    Ok(UpdateStatus {
        current,
        latest: if latest.is_empty() { None } else { Some(latest) },
        available: newer,
        url: newer.then_some(url),
        message,
    })
}

#[cfg(not(target_os = "android"))]
async fn download_to(url: &str, name: &str) -> Result<std::path::PathBuf, String> {
    let resp = client()?.get(url).send().await.map_err(|e| format!("Download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Download failed ({})", resp.status()));
    }
    let dir = std::env::temp_dir().join("lumaread-update");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(name);
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Mount the downloaded disk image, replace /Applications/LumaRead.app, and clear quarantine.
#[cfg(not(target_os = "android"))]
fn install_dmg(dmg: std::path::PathBuf) -> Result<(), String> {
    use std::process::Command;
    let output = Command::new("hdiutil")
        .args(["attach", "-nobrowse", "-readonly"])
        .arg(&dmg)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(if err.trim().is_empty() { "Could not open the update".into() } else { err.trim().to_string() });
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let volume = text
        .split_whitespace()
        .find(|part| part.starts_with("/Volumes/"))
        .ok_or("Could not open the update disk")?
        .to_string();
    let result = (|| {
        let src = std::path::Path::new(&volume).join("LumaRead.app");
        if !src.is_dir() {
            return Err("The update does not contain LumaRead".into());
        }
        let dest = std::path::Path::new("/Applications/LumaRead.app");
        let _ = std::fs::remove_dir_all(dest);
        let copied = Command::new("ditto").arg(&src).arg(dest).status().map_err(|e| e.to_string())?;
        if !copied.success() {
            return Err("Could not copy LumaRead into Applications".into());
        }
        let cleared = Command::new("xattr").args(["-cr"]).arg(dest).status().map_err(|e| e.to_string())?;
        if !cleared.success() {
            return Err("Could not clear the download quarantine".into());
        }
        Command::new("open").arg(dest).spawn().map_err(|e| e.to_string())?;
        Ok(())
    })();
    let _ = Command::new("hdiutil").args(["detach", &volume]).status();
    result
}

#[tauri::command]
pub async fn install_update(app: AppHandle, url: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let _ = (app, url);
        return Err("Open the Android installer from the app".into());
    }
    #[cfg(not(target_os = "android"))]
    {
        let path = download_to(&url, "LumaRead.dmg").await?;
        let installed = tauri::async_runtime::spawn_blocking(move || install_dmg(path)).await.map_err(|e| e.to_string())?;
        installed?;
        app.exit(0);
        Ok(())
    }
}
