//! Read aloud on Android through the system TextToSpeech engine (offline voices installed on the phone).
//! macOS uses the webview's own speechSynthesis, so these commands only exist on Android.
use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Speak {
    pub text: String,
    /// BCP 47, e.g. "id-ID" or "en-US"
    pub lang: String,
    /// 1.0 = normal speed
    pub rate: f32,
}

#[cfg(target_os = "android")]
struct Handle<R: Runtime>(tauri::plugin::PluginHandle<R>);

/// Resolves when the text has been spoken, or as soon as `stop` interrupts it
#[tauri::command]
async fn speak<R: Runtime>(app: tauri::AppHandle<R>, payload: Speak) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        return app.state::<Handle<R>>().0.run_mobile_plugin::<()>("speak", payload).map_err(|e| e.to_string());
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, payload);
        Err("Read aloud through this plugin is only available on Android".into())
    }
}

#[tauri::command]
fn stop<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        return app.state::<Handle<R>>().0.run_mobile_plugin::<()>("stop", ()).map_err(|e| e.to_string());
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("readaloud")
        .invoke_handler(tauri::generate_handler![speak, stop])
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                let handle = _api.register_android_plugin("com.lumaread.readaloud", "ReadAloudPlugin")?;
                _app.manage(Handle(handle));
            }
            Ok(())
        })
        .build()
}
