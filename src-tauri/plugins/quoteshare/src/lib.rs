//! Android share sheet for quote cards: Instagram Stories, WhatsApp Status and any app that accepts images.
//! Desktop has no share sheet here; the frontend offers save/copy instead.
use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareImage {
    /// PNG bytes, base64-encoded (no data: prefix)
    pub base64: String,
    pub file_name: String,
    /// Caption for apps that accept one alongside the image (e.g. WhatsApp)
    pub text: Option<String>,
    pub title: Option<String>,
}

#[cfg(target_os = "android")]
struct Handle<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallApk {
    pub path: String,
}

/// Install an APK that was already downloaded into app storage.
pub fn install_file<R: Runtime>(app: &tauri::AppHandle<R>, path: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        return app
            .state::<Handle<R>>()
            .0
            .run_mobile_plugin::<()>("installApk", InstallApk { path })
            .map_err(|e| e.to_string());
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, path);
        Err("Updates install from the disk image on this device".into())
    }
}

#[tauri::command]
fn install_apk<R: Runtime>(app: tauri::AppHandle<R>, path: String) -> Result<(), String> {
    install_file(&app, path)
}

#[tauri::command]
fn share_image<R: Runtime>(app: tauri::AppHandle<R>, payload: ShareImage) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        return app
            .state::<Handle<R>>()
            .0
            .run_mobile_plugin::<()>("shareImage", payload)
            .map_err(|e| e.to_string());
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, payload);
        Err("Sharing is only available on Android".into())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("quoteshare")
        .invoke_handler(tauri::generate_handler![share_image, install_apk])
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                let handle = _api.register_android_plugin("com.lumaread.quoteshare", "QuoteSharePlugin")?;
                _app.manage(Handle(handle));
            }
            Ok(())
        })
        .build()
}
