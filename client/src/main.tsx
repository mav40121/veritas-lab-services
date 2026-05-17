import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App";
import "./index.css";

// Initialize Sentry before anything else so it can capture early-render
// errors. Guarded by env var so the app loads cleanly when
// VITE_SENTRY_DSN is unset (e.g. local dev without Sentry configured).
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE || "production",
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}

// Legacy hash route redirect: if someone arrives at /#/some-path
// (old bookmarks, LinkedIn posts, emails), redirect to /some-path
if (window.location.hash && window.location.hash.startsWith("#/")) {
  const path = window.location.hash.slice(1); // remove the #
  window.history.replaceState(null, "", path);
}

// Wrap the app in Sentry.ErrorBoundary so any uncaught React render error
// gets reported AND the user sees a friendly fallback instead of a blank
// white screen. The fallback intentionally stays simple to avoid relying
// on any of the same component infrastructure that just crashed.
const FallbackUI = () => (
  <div style={{ padding: "2rem", textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
    <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>Something went wrong</h1>
    <p style={{ color: "#666", marginBottom: "1rem" }}>An unexpected error occurred. Try refreshing the page.</p>
    <button
      onClick={() => window.location.reload()}
      style={{ padding: "0.5rem 1rem", fontSize: "0.875rem", cursor: "pointer" }}
    >
      Refresh
    </button>
  </div>
);

createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary fallback={<FallbackUI />}>
    <App />
  </Sentry.ErrorBoundary>
);
