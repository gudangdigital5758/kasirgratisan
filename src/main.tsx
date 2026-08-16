import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./i18n";
import { initErrorReporting } from "./lib/error-report";
import { db } from "./lib/db";
import { applyDarkMode, syncThemePref } from "./hooks/use-dark-mode";

// Global handlers for errors that React's ErrorBoundary cannot catch:
//  - unhandled promise rejections (async code)
//  - uncaught runtime errors (event handlers, setTimeout, etc.)
// For now we log to the console; this is also where a remote logger would hook in.
if (typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (event) => {
    console.error("[UnhandledRejection]", event.reason);
  });

  window.addEventListener("error", (event) => {
    console.error("[WindowError]", event.message, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: event.error,
    });
  });

  // Remote error monitoring (production only, throttled, via platform_events).
  initErrorReporting();
}

// Terapkan dark mode tersimpan (atau preferensi sistem) sebelum render pertama.
db.storeSettings
  .toCollection()
  .first()
  .then((s) => {
    applyDarkMode(s?.darkMode ?? null);
    syncThemePref(s?.darkMode ?? null);
  })
  .catch(() => applyDarkMode(null));

createRoot(document.getElementById("root")!).render(<App />);