import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/tokens.css";

// Keep portable dark utility classes aligned; colors come from native VS Code variables.
const syncTheme = () => {
  const dark = document.body.classList.contains("vscode-dark") || document.body.classList.contains("vscode-high-contrast");
  document.documentElement.classList.toggle("dark", dark);
};
syncTheme();
new MutationObserver(syncTheme).observe(document.body, { attributes: true, attributeFilter: ["class"] });

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
