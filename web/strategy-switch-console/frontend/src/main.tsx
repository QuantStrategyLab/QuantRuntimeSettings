import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./app/tokens.css";
import "./app/app.css";
import { loadPreferences, resolveTheme } from "./lib/prefs";

const preferences = loadPreferences();
document.documentElement.dataset.theme = resolveTheme(preferences.theme, window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
document.documentElement.lang = preferences.language === "zh" ? "zh-CN" : "en";

const root = document.getElementById("root");
// The Meridian desk lives under #/desk/* and loads as its own chunk; every other URL
// boots the existing console unchanged.
if (root && /^#\/desk(?:[/?]|$)/.test(window.location.hash)) {
  void import("./desk/DeskApp").then(({ mountDesk }) => mountDesk(root));
} else if (root) {
  createRoot(root).render(<App />);
}
