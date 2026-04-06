import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Legacy hash route redirect: if someone arrives at /#/some-path
// (old bookmarks, LinkedIn posts, emails), redirect to /some-path
if (window.location.hash && window.location.hash.startsWith("#/")) {
  const path = window.location.hash.slice(1); // remove the #
  window.history.replaceState(null, "", path);
}

createRoot(document.getElementById("root")!).render(<App />);
