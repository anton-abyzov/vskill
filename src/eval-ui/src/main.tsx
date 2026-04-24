import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "./App";
import { ThemeProvider } from "./theme/ThemeProvider";
import { runScopeRenameMigration } from "./lib/scope-migration";

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

// 0698 T-006: migrate legacy scope-named localStorage keys to new 5-value
// vocabulary before the Sidebar reads initial collapse state. Idempotent +
// flag-gated so production users only pay the cost once.
if (typeof window !== "undefined" && window.localStorage) {
  try {
    runScopeRenameMigration(window.localStorage);
  } catch {
    /* non-fatal — flag guards subsequent runs */
  }
}

// 0703 hotfix: wrap App in HashRouter so `CreateSkillPage` (mounted via a
// hash-based conditional in App.tsx) can use `useNavigate`/`Link` without
// blowing up on missing router context. The actual routing tree is a single
// `/create` branch — StudioLayout owns everything else.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </HashRouter>
  </StrictMode>,
);
