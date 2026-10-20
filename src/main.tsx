import { isTauri } from "@tauri-apps/api/core";
import React from "react";
import ReactDOM from "react-dom/client";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

// LumaRead is app-only (macOS / Android); in a plain browser the library code is never loaded
if (isTauri()) {
  // Before the first paint, so a dark-theme user never sees a light flash
  import("./features/settings/prefs").then(({ applyAppTheme, loadPrefs }) => applyAppTheme(loadPrefs().appTheme));
  import("./App").then(({ default: App }) =>
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    ),
  );
} else {
  root.render(
    <main style={{ fontFamily: "system-ui, -apple-system, Roboto, sans-serif", textAlign: "center", padding: "20vh 16px" }}>
      <img src="/lumaread-ico.jpeg" alt="" width={72} height={72} />
      <h1>LumaRead</h1>
      <p>LumaRead runs as an app on macOS and Android. Open the installed app to read.</p>
    </main>,
  );
}
