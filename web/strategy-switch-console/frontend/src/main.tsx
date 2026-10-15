import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./app/app.css";

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
