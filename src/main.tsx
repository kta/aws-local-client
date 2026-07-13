import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// When built for E2E (`VITE_E2E=1`, see `npm run e2e:build`), load the
// WebdriverIO Tauri frontend plugin before the app mounts. It registers the
// automation bridge (window.wdioTauri, invoke interception) the embedded
// WebDriver server attaches to. It is excluded from normal/production builds.
async function bootstrap() {
  if (import.meta.env.VITE_E2E) {
    await import("@wdio/tauri-plugin");
  }
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
