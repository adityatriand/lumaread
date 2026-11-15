//! Check the Google Drive folder, which a local build overwrites on each publish.
use serde::Serialize;
use std::collections::BTreeMap;
use std::io::Write;
use tauri::{AppHandle, Emitter, Manager};

/// Public `version.txt` in the shared "LumaRead updates" folder. Publish overwrites this file, so the id stays put.
const VERSION_FILE_ID: &str = "1CtRkk2eXAASTHdk-nZtvrCXZuv50k7_b";

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

fn asset_key() -> &'static str {
    if cfg!(target_os = "android") {
        "android-arm64"
    } else if cfg!(target_arch = "x86_64") {
        "macos-x64"
    } else {
        "macos-aarch64"
    }
}

fn drive_download_url(id: &str) -> String {
    format!("https://drive.usercontent.google.com/download?id={id}&export=download&confirm=t")
}

/// `version` on the first line, then `macos-aarch64=<file id>` lines for each installer.
fn parse_published(text: &str) -> (String, BTreeMap<String, String>) {
    let mut lines = text.lines().map(str::trim).filter(|line| !line.is_empty());
    let version = lines.next().unwrap_or("").to_string();
    let files = lines
        .filter_map(|line| {
            let (name, id) = line.split_once('=')?;
            let name = name.trim();
            let id = id.trim();
            (!name.is_empty() && !id.is_empty()).then(|| (name.to_string(), id.to_string()))
        })
        .collect();
    (version, files)
}

fn looks_like_html(body: &[u8]) -> bool {
    let head = body.get(..64).unwrap_or(body);
    let text = String::from_utf8_lossy(head).trim_start().to_ascii_lowercase();
    text.starts_with("<!doctype html") || text.starts_with("<html")
}

fn html_confirm(body: &[u8]) -> Option<String> {
    if !looks_like_html(body) {
        return None;
    }
    let text = String::from_utf8_lossy(body);
    let marker = "https://drive.usercontent.google.com/download";
    let start = text.find(marker)?;
    let rest = &text[start..];
    let end = rest.find('"').unwrap_or(rest.len());
    let mut url = rest[..end].replace("&amp;", "&");
    if !url.contains("confirm=") {
        url.push_str(if url.contains('?') { "&confirm=t" } else { "?confirm=t" });
    }
    Some(url)
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("LumaRead")
        .redirect(reqwest::redirect::Policy::limited(20))
        .build()
        .map_err(|e| e.to_string())
}

async fn get_bytes(url: &str) -> Result<Vec<u8>, String> {
    let http = client()?;
    let mut url = url.to_string();
    for _ in 0..3 {
        let resp = http.get(&url).send().await.map_err(|e| format!("Couldn't reach updates: {e}"))?;
        let status = resp.status();
        if status.as_u16() == 404 {
            return Err("missing".into());
        }
        if !status.is_success() {
            return Err(format!("Couldn't check for updates ({status})"));
        }
        let body = resp.bytes().await.map_err(|e| e.to_string())?;
        if looks_like_html(&body) {
            url = html_confirm(&body).ok_or("Couldn't reach updates")?;
            continue;
        }
        return Ok(body.to_vec());
    }
    Err("Couldn't reach updates".into())
}

#[tauri::command]
pub async fn check_update() -> Result<UpdateStatus, String> {
    let current = current();
    let body = match get_bytes(&drive_download_url(VERSION_FILE_ID)).await {
        Ok(body) => body,
        Err(error) if error == "missing" => {
            return Ok(UpdateStatus {
                current,
                latest: None,
                available: false,
                url: None,
                message: "No update has been published yet.".into(),
            });
        }
        Err(error) => return Err(error),
    };
    let text = String::from_utf8_lossy(&body);
    let (latest, files) = parse_published(&text);
    let mine = parse_version(&current);
    let theirs = parse_version(&latest);
    let newer = match (mine, theirs) {
        (Some(a), Some(b)) => b > a,
        _ => false,
    };
    let file_id = files.get(asset_key()).cloned();
    let message = if newer && file_id.is_some() {
        format!("Version {latest} is ready to install.")
    } else if newer {
        format!("Version {latest} is published, but there is no installer for this device yet.")
    } else {
        format!("You're on {current}, the latest version.")
    };
    Ok(UpdateStatus {
        current,
        latest: if latest.is_empty() { None } else { Some(latest) },
        available: newer && file_id.is_some(),
        url: file_id.map(|id| drive_download_url(&id)),
        message,
    })
}

#[derive(Clone, Serialize)]
struct UpdateProgress {
    received: u64,
    total: Option<u64>,
    phase: &'static str,
}

fn emit_progress(app: &AppHandle, received: u64, total: Option<u64>, phase: &'static str) {
    let _ = app.emit("update-progress", UpdateProgress { received, total, phase });
}

async fn download_to(app: &AppHandle, url: &str, name: &str) -> Result<std::path::PathBuf, String> {
    let http = client()?;
    let mut url = url.to_string();
    for _ in 0..3 {
        let resp = http.get(&url).send().await.map_err(|e| format!("Download failed: {e}"))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(format!("Download failed ({status})"));
        }
        let html = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.contains("text/html"));
        if html {
            let body = resp.bytes().await.map_err(|e| e.to_string())?;
            url = html_confirm(&body).ok_or("Couldn't reach updates")?;
            continue;
        }
        let total = resp.content_length();
        let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("updates");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = dir.join(name);
        let mut file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
        let mut received = 0u64;
        let mut last = std::time::Instant::now() - std::time::Duration::from_secs(1);
        while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
            file.write_all(&chunk).map_err(|e| e.to_string())?;
            received += chunk.len() as u64;
            if last.elapsed() >= std::time::Duration::from_millis(200) {
                emit_progress(app, received, total, "download");
                last = std::time::Instant::now();
            }
        }
        file.sync_all().map_err(|e| e.to_string())?;
        emit_progress(app, received, total.or(Some(received)), "download");
        return Ok(path);
    }
    Err("Download failed".into())
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
        // The running process is still the old build. Open the new one after this process exits.
        let _ = std::process::Command::new("sh")
            .args(["-c", "(sleep 0.8; open -n /Applications/LumaRead.app) >/dev/null 2>&1 &"])
            .spawn();
        Ok(())
    })();
    let _ = Command::new("hdiutil").args(["detach", &volume]).status();
    result
}

#[tauri::command]
pub async fn install_update(app: AppHandle, url: String) -> Result<(), String> {
    let name = if cfg!(target_os = "android") { "LumaRead.apk" } else { "LumaRead.dmg" };
    let path = download_to(&app, &url, name).await?;
    emit_progress(&app, 1, Some(1), "install");
    #[cfg(target_os = "android")]
    {
        return tauri_plugin_quoteshare::install_file(&app, path.to_string_lossy().to_string());
    }
    #[cfg(not(target_os = "android"))]
    {
        let installed = tauri::async_runtime::spawn_blocking(move || install_dmg(path)).await.map_err(|e| e.to_string())?;
        installed?;
        app.exit(0);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn published_manifest_keeps_version_and_files() {
        let (version, files) = parse_published("1.1.5\nmacos-aarch64=abc\nandroid-arm64=def\n");
        assert_eq!(version, "1.1.5");
        assert_eq!(files.get("macos-aarch64").map(String::as_str), Some("abc"));
        assert_eq!(files.get("android-arm64").map(String::as_str), Some("def"));
    }

    #[test]
    fn confirm_page_points_at_the_real_file() {
        let page = br#"<html><a href="https://drive.usercontent.google.com/download?id=abc&amp;export=download&amp;confirm=t">"#;
        assert_eq!(
            html_confirm(page).as_deref(),
            Some("https://drive.usercontent.google.com/download?id=abc&export=download&confirm=t")
        );
        assert!(html_confirm(b"1.1.4\n").is_none());
    }
}
