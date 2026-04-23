import { useTheme } from "../theme/useTheme";
import {
  THEME_STORAGE_KEY,
  type ThemeMode,
  type ResolvedTheme,
} from "../theme/theme-utils";
import { ProvidersSegment, type ProvidersSegmentProvider } from "./ProvidersSegment";

function readRawStoredMode(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

interface Props {
  projectPath?: string | null;
  modelName?: string | null;
  health?: "ok" | "degraded" | "down";
  onPathClick?: () => void;
  /** 0682: providers + handlers for the StatusBar lock/unlock segment. */
  providers?: ProvidersSegmentProvider[];
  onOpenProviderSettings?: (providerId: string) => void;
  onOpenProviderInstallHelp?: (providerId: string) => void;
}

/**
 * Status bar — small fixed-height row at the bottom of the shell.
 * Shows (left to right): project path, model name, health dot, theme toggle.
 *
 * Theme toggle cycles: light → dark → auto. The aria-label always describes
 * the next mode so screen readers announce the action rather than the state.
 */
export function StatusBar({
  projectPath,
  modelName,
  health = "ok",
  onPathClick,
  providers,
  onOpenProviderSettings,
  onOpenProviderInstallHelp,
}: Props) {
  const { mode, resolvedTheme, setTheme } = useTheme();
  // T-0684 (B2): When the user has not persisted any theme choice, an
  // "auto" mode is really the default — clicking should FLIP the rendered
  // theme so the toggle is observable. Once the user has explicitly chosen
  // "auto" (via a previous click from dark → auto) the canonical
  // light → dark → auto cycle continues to advance to "light".
  const storedRaw = readRawStoredMode();
  const autoIsExplicit = storedRaw === "auto";
  const next = nextMode(mode, resolvedTheme, autoIsExplicit);
  const healthColor =
    health === "down"
      ? "var(--status-own)" // warm red/amber from own token (no raw hex)
      : health === "degraded"
        ? "var(--status-own)"
        : "var(--status-installed)";

  return (
    <div
      role="contentinfo"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        height: "100%",
        width: "100%",
        padding: "0 12px",
        fontSize: 11,
        fontFamily: "var(--font-sans)",
        color: "var(--text-secondary)",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {/* Project path */}
      <button
        type="button"
        onClick={onPathClick}
        aria-label={projectPath ? `Project path ${projectPath}` : "No project path"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: "transparent",
          border: "none",
          padding: 0,
          color: "var(--text-secondary)",
          fontFamily: "var(--font-mono)",
          cursor: onPathClick ? "pointer" : "default",
          maxWidth: 360,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={projectPath ?? ""}
      >
        <Dot color="var(--text-secondary)" />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {projectPath ?? "—"}
        </span>
      </button>

      <Sep />

      {/* Model */}
      <span title={modelName ?? ""} style={{ fontFamily: "var(--font-mono)" }}>
        {modelName ?? "—"}
      </span>

      <Sep />

      {/* Health */}
      <span
        aria-label={`Health: ${health}`}
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        <Dot color={healthColor} />
        <span style={{ textTransform: "capitalize" }}>{health}</span>
      </span>

      {providers && providers.length > 0 && (
        <>
          <Sep />
          <ProvidersSegment
            providers={providers}
            onOpenSettings={onOpenProviderSettings}
            onOpenInstallHelp={onOpenProviderInstallHelp}
          />
        </>
      )}

      <div style={{ flex: 1 }} />

      {/* Theme toggle */}
      <button
        type="button"
        data-testid="theme-toggle"
        onClick={() => setTheme(next)}
        aria-label={`Switch to ${next} theme`}
        title={`Theme: ${mode} — click for ${next}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: "transparent",
          border: "1px solid var(--border-default)",
          padding: "2px 8px",
          borderRadius: 4,
          color: "var(--text-secondary)",
          cursor: "pointer",
          fontSize: 11,
          height: 20,
        }}
      >
        <ThemeGlyph mode={mode} />
        <span style={{ textTransform: "capitalize" }}>{mode}</span>
      </button>
    </div>
  );
}

// T-0684 (B2): cycle is light → dark → auto → flip(resolved).
//
// Prior implementation cycled mode=auto → "light" unconditionally, which on
// a light-OS left `data-theme` pinned at "light" (auto resolves to light;
// setTheme("light") resolves to the same). The qa-click-audit + keyboard-
// shortcuts specs assert that clicking / Cmd+Shift+D always FLIPS
// `data-theme`, so from mode=auto we now flip relative to the resolved
// theme — guaranteeing the attribute changes on every toggle.
//
// `theme-persistence.spec.ts:79` still passes: starting from mode=dark the
// next value is "auto" (unchanged), and after landing on auto the aria-
// label advances to "Switch to light theme" when resolved=dark (system
// dark) — exactly the contract the spec checks (/Switch to light theme/).
function nextMode(
  mode: ThemeMode,
  resolved: ResolvedTheme,
  autoIsExplicit: boolean,
): ThemeMode {
  if (mode === "light") return "dark";
  if (mode === "dark") return "auto";
  // mode === "auto":
  //  - If the user explicitly chose "auto" (storedRaw === "auto") continue
  //    the canonical light → dark → auto → light cycle to advance to
  //    "light" — the long-standing behavior asserted by
  //    theme-persistence.spec.ts:79.
  //  - Otherwise (no stored value, natural default), flip relative to the
  //    currently rendered theme so data-theme is guaranteed to change on
  //    click. Covers qa-click-audit.spec.ts:230 and
  //    keyboard-shortcuts.spec.ts:100.
  if (autoIsExplicit) return "light";
  return resolved === "light" ? "dark" : "light";
}

function Dot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: color,
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}

function Sep() {
  return (
    <span aria-hidden="true" style={{ color: "var(--border-default)" }}>
      |
    </span>
  );
}

function ThemeGlyph({ mode }: { mode: ThemeMode }) {
  if (mode === "dark") {
    return (
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    );
  }
  if (mode === "light") {
    return (
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    );
  }
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" />
    </svg>
  );
}
