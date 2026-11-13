import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./app/tokens.css";
import "./app/app.css";
import { loadPreferences, resolveTheme } from "./lib/prefs";
import { bootsLegacyConsole } from "./desk/router.ts";

const preferences = loadPreferences();
document.documentElement.dataset.theme = resolveTheme(preferences.theme, window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
document.documentElement.lang = preferences.language === "zh" ? "zh-CN" : "en";

const root = document.getElementById("root");
// The Meridian desk is the default entry: "/", an empty hash and every #/desk/* route mount
// it as its own chunk. Only explicit legacy deep links (?page=<old page> outside #/desk, such
// as the Worker's credential-rotation link) still boot the old console.
const legacyEntry = () => bootsLegacyConsole(window.location.search, window.location.hash);
const startsInLegacy = legacyEntry();
window.addEventListener("hashchange", () => {
  // A document reload releases the previous React root and pending imports.
  // Within either application, its existing router retains ownership.
  if (legacyEntry() !== startsInLegacy) {
    window.location.reload();
  }
});
if (root && !startsInLegacy) {
  void import("./desk/DeskApp").then(({ mountDesk }) => mountDesk(root));
} else if (root) {
  createRoot(root).render(<App />);
}
