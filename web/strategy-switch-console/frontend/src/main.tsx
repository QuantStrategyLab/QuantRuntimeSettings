import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./app/app.css";
import { loadPreferences, resolveTheme } from "./lib/prefs";

const preferences = loadPreferences();
document.documentElement.dataset.theme = resolveTheme(preferences.theme, window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
document.documentElement.lang = preferences.language === "zh" ? "zh-CN" : "en";

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
