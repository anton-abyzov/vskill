import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ThemeProvider } from "./theme/ThemeProvider";

// Variable font bundles — loaded before globals.css so @theme tokens
// (--font-serif / --font-sans / --font-mono) resolve to present families.
// The Vite manualChunks rule routes these imports to a separate "fonts" chunk.
import "@fontsource-variable/source-serif-4";
import "@fontsource-variable/inter-tight";
import "@fontsource-variable/jetbrains-mono";

import "./styles/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
