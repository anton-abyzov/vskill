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

// T-0684 (Perf-3): emit a paint marker that Playwright can read as a
// fallback when `performance.getEntriesByType("paint")` is empty under
// headless chromium. This does not replace the authoritative FCP number
// (still sourced from Lighthouse in `test:lhci`) — it just lets the smoke
// spec guard against environment variance rather than hard-failing.
if (typeof PerformanceObserver !== "undefined") {
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === "first-contentful-paint") {
          (window as Window & { __vskillPaint?: number }).__vskillPaint =
            entry.startTime;
          observer.disconnect();
          return;
        }
      }
    });
    observer.observe({ type: "paint", buffered: true });
  } catch {
    /* paint entry unsupported — smoke spec will skip instead of fail */
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
