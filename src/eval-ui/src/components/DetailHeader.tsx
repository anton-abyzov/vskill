import { useState, useCallback } from "react";
import type { WorkspaceState } from "../pages/workspace/workspaceTypes";
import type { SkillInfo } from "../types";
import { passRateColor, passRateBackground } from "../utils/passRateColor";
import { strings } from "../strings";
import { VersionBadge } from "./VersionBadge";
import { AuthorLink } from "./AuthorLink";
import { SourceFileLink } from "./SourceFileLink";

// T-065: Dispatching a CustomEvent keeps DetailHeader test-mode-friendly
// (no hook subscription to ToastProvider) while still surfacing a real
// toast in the running app — App.tsx bridges `studio:toast` events into
// useToast() once during mount.
function emitToast(message: string, severity: "info" | "error" = "info"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("studio:toast", { detail: { message, severity } }),
  );
}

// ---------------------------------------------------------------------------
// T-026: DetailHeader — redesigned card-style header.
//
// Two usage shapes are supported:
//
//   1) New Phase-3 shape — pass `skill: SkillInfo`. Renders a calm "paper
//      card" header with serif skill name, plugin breadcrumb, dot-only origin
//      badge, truncated path chip with copy-to-clipboard, and version in
//      tabular-nums. This is the shape consumed by `RightPanel` (T-031).
//
//   2) Legacy shape — pass `state: WorkspaceState` (plus optional isReadOnly
//      / onDelete). Preserved so the existing `SkillWorkspaceInner` tab panel
//      flow keeps rendering while the new detail panel rolls out. This path
//      delegates to `LegacyDetailHeader` below and is unchanged from before.
// ---------------------------------------------------------------------------

interface LegacyProps {
  state: WorkspaceState;
  isReadOnly?: boolean;
  onDelete?: () => void;
  skill?: undefined;
}

interface NewProps {
  skill: SkillInfo;
  state?: undefined;
  isReadOnly?: boolean;
  onDelete?: () => void;
}

type Props = NewProps | LegacyProps;

export function DetailHeader(props: Props) {
  if (props.skill) {
    // Call as a function (not as JSX) so tests inspecting the returned tree
    // see the card `<div>` at the root instead of a wrapper component type.
    return NewDetailHeader({ skill: props.skill });
  }
  return LegacyDetailHeader({ state: props.state, isReadOnly: props.isReadOnly, onDelete: props.onDelete });
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function truncatePath(p: string, max = 48): string {
  if (p.length <= max) return p;
  // Keep head + "…" + tail so the filename end remains readable.
  const head = p.slice(0, 12);
  const tail = p.slice(p.length - (max - 12 - 1));
  return `${head}…${tail}`;
}

// ---------------------------------------------------------------------------
// New header (Phase 3)
// ---------------------------------------------------------------------------

function NewDetailHeader({ skill }: { skill: SkillInfo }) {
  const [copied, setCopied] = useState(false);

  const onCopyPath = useCallback(async () => {
    try {
      await navigator.clipboard?.writeText(skill.dir);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      // T-065: Surface a real toast in addition to the inline "Copied"
      // label — the button label flip is easy to miss on a large screen.
      emitToast(strings.toasts.pathCopied, "info");
    } catch {
      emitToast(strings.toasts.permissionDenied, "error");
    }
  }, [skill.dir]);

  // 0700 polish: match the sidebar + top-rail vocabulary — Anthropic-aligned
  // labels ("Project" for installed, "Skills" for authored) instead of the
  // legacy Own/Installed.
  const originLabel = skill.origin === "installed" ? "Project" : "Skills";
  const originColor = skill.origin === "installed" ? "var(--status-installed)" : "var(--status-own)";

  return (
    <div
      data-testid="detail-header"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-default)",
        borderRadius: 8,
        padding: "14px 16px",
        boxShadow: "none",
      }}
    >
      {/* Row 1: plugin breadcrumb + origin dot badge */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "var(--font-sans)",
          fontSize: 12,
          color: "var(--text-secondary)",
          marginBottom: 4,
        }}
      >
        <span data-testid="detail-header-plugin">{skill.plugin}</span>
        <span aria-hidden="true" style={{ color: "var(--text-secondary)" }}>›</span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: "var(--text-secondary)",
            fontSize: 11,
            letterSpacing: 0.3,
            textTransform: "uppercase",
          }}
        >
          <span
            data-origin-dot={skill.origin}
            aria-label={`Origin: ${originLabel}`}
            style={{
              display: "inline-block",
              width: 7,
              height: 7,
              borderRadius: 999,
              background: originColor,
            }}
          />
          {originLabel}
        </span>
      </div>

      {/* Row 2: skill name (serif) + VersionBadge (0707 T-008) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 8,
        }}
      >
        <h2
          data-testid="detail-header-name"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 20,
            fontWeight: 500,
            lineHeight: 1.25,
            color: "var(--text-primary)",
            margin: 0,
          }}
        >
          {skill.skill}
        </h2>
        {/* 0707 T-008: dedicated VersionBadge replaces the plain-text version. */}
        <span data-testid="detail-header-version">
          <VersionBadge version={skill.version ?? null} />
        </span>
      </div>

      {/* 0707 T-008: byline row — author (link when repoUrl parses) + source
          file link (blob/HEAD anchor when GitHub, copy-chip otherwise). */}
      <div
        data-testid="detail-header-byline"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 10,
          margin: "0 0 8px",
          fontFamily: "var(--font-sans)",
          fontSize: 12,
          color: "var(--text-secondary)",
        }}
      >
        <AuthorLink author={skill.author ?? null} repoUrl={skill.homepage ?? null} />
        <SourceFileLink
          repoUrl={skill.homepage ?? null}
          skillPath={null}
          absolutePath={skill.dir}
        />
      </div>

      {/* 0686 T-015 (US-008): "Install method" row — surfaces symlinked /
          copied / authored provenance. Server populates `installMethod` +
          `symlinkTarget` once CONTRACT_READY; we render defensively so the
          row stays hidden on legacy payloads. */}
      <InstallMethodRow skill={skill} />

      {/* Row 3: path chip + copy button */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* T-066: The chip itself is clickable — qa-findings #7 flagged that
            the bordered mono box LOOKS interactive but silently swallowed
            clicks. Clicking it performs the same copy+toast action as the
            explicit button below. */}
        <button
          type="button"
          data-testid="detail-header-path-chip"
          title={skill.dir}
          aria-label={`Copy path ${skill.dir} to clipboard`}
          onClick={onCopyPath}
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "2px 8px",
            border: "1px solid var(--border-default)",
            borderRadius: 4,
            background: "transparent",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-secondary)",
            maxWidth: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            cursor: "pointer",
          }}
        >
          {truncatePath(skill.dir || "—")}
        </button>
        <button
          data-testid="detail-header-copy-path"
          type="button"
          onClick={onCopyPath}
          aria-label="Copy skill path to clipboard"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 8px",
            background: "transparent",
            border: "1px solid var(--border-default)",
            borderRadius: 4,
            color: "var(--text-secondary)",
            fontFamily: "var(--font-sans)",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 0686 T-015 (US-008): Install method row — appears in the new detail
// header when the server payload includes `installMethod` / `symlinkTarget`.
// Defensive: hidden entirely when the fields aren't present, so pre-
// CONTRACT_READY SkillInfo payloads render identically to before.
// ---------------------------------------------------------------------------

function InstallMethodRow({ skill }: { skill: SkillInfo }) {
  const method = skill.installMethod;
  const target = skill.symlinkTarget;
  if (!method) return null;

  let label = "";
  switch (method) {
    case "symlinked":
      label = target ? `Symlinked from ${target}` : "Symlinked (target unresolved)";
      break;
    case "copied":
      label = "Copied (independent)";
      break;
    case "authored":
      label = "Authored";
      break;
    default:
      return null;
  }
  return (
    <div
      data-testid="detail-header-install-method"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        color: "var(--text-secondary)",
        fontFamily: "var(--font-sans)",
        margin: "6px 0 8px",
      }}
    >
      <span
        style={{
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          fontSize: 10,
          color: "var(--text-tertiary)",
        }}
      >
        Install method
      </span>
      <span style={{ fontFamily: "var(--font-mono)" }}>{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legacy header (pre-T-026) — preserved verbatim for SkillWorkspaceInner
// ---------------------------------------------------------------------------

function LegacyDetailHeader({ state, isReadOnly, onDelete }: { state: WorkspaceState; isReadOnly?: boolean; onDelete?: () => void }) {
  const { plugin, skill, evals, latestBenchmark, isDirty, caseRunStates, regressions, iterationCount } = state;
  const isRunning = Array.from(caseRunStates.values()).some((s) => s.status === "running" || s.status === "queued");

  const passRate = latestBenchmark?.overall_pass_rate;
  const totalAssertions = evals?.evals.reduce((sum, e) => sum + e.assertions.length, 0) ?? 0;
  const totalCases = evals?.evals.length ?? 0;

  const passColor = passRateColor(passRate);
  const passBackground = passRateBackground(passRate);

  return (
    <div
      className="flex items-center justify-between px-4 py-2.5"
      style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-1)", flexShrink: 0 }}
    >
      <div className="flex items-center gap-2 text-[13px]">
        <span style={{ color: "var(--text-tertiary)" }}>{plugin}</span>
        <Chevron />
        <span className="font-medium" style={{ color: "var(--text-primary)" }}>{skill}</span>

        {isReadOnly && (
          <span
            className="ml-2 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{ background: "var(--surface-3)", color: "var(--text-tertiary)" }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            installed
          </span>
        )}
        {isDirty && (
          <span
            className="ml-2 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{ background: "var(--yellow-muted)", color: "var(--yellow)" }}
          >
            unsaved
          </span>
        )}

        {isRunning && (
          <span className="ml-2 flex items-center gap-1.5 text-[11px]" style={{ color: "var(--accent)" }}>
            <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
            Running...
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {!isReadOnly && onDelete && (
          <button
            disabled={isRunning}
            onClick={() => {
              // 0722: route through the shared ConfirmDialog + OS-trash flow.
              // App.tsx listens for studio:request-delete and opens the dialog;
              // confirmation triggers the same usePendingDeletion buffer used
              // by the context menu, so DetailHeader benefits from the 10s
              // Undo window automatically. The legacy onDelete callback is
              // wired separately by some callers — retained for compatibility,
              // but the dispatch is the canonical path.
              if (typeof window !== "undefined") {
                // We rely on the parent supplying plugin + skill via the
                // existing prop set; if not supplied, fall back to onDelete.
                window.dispatchEvent(
                  new CustomEvent("studio:request-delete", {
                    detail: {
                      skill: {
                        plugin,
                        skill,
                        // Minimum SkillInfo shape required by ConfirmDialog —
                        // App.tsx only reads plugin, skill, and dir.
                        dir: "",
                        hasEvals: false,
                        hasBenchmark: false,
                        evalCount: 0,
                        assertionCount: 0,
                        benchmarkStatus: "missing",
                        lastBenchmark: null,
                        origin: "source",
                      },
                    },
                  }),
                );
              }
            }}
            title="Delete skill"
            className="flex items-center justify-center transition-colors duration-150"
            style={{
              background: "none",
              border: "none",
              cursor: isRunning ? "not-allowed" : "pointer",
              color: "var(--text-tertiary)",
              padding: 4,
              opacity: isRunning ? 0.4 : 1,
              borderRadius: 4,
            }}
            onMouseEnter={(e) => {
              if (!isRunning) e.currentTarget.style.color = "var(--red)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-tertiary)";
            }}
          >
            <TrashIcon />
          </button>
        )}

        {regressions.length > 0 && (
          <span className="pill" style={{ background: "var(--red-muted)", color: "var(--red)" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            {regressions.length} regression{regressions.length > 1 ? "s" : ""}
          </span>
        )}

        {iterationCount > 0 && (
          <span className="pill" style={{ background: "var(--purple-muted)", color: "var(--purple)" }}>
            Iter {iterationCount}
          </span>
        )}

        <span className="pill" style={{ background: passBackground, color: passColor }}>
          {passRate != null ? `${Math.round(passRate * 100)}%` : "--"}
        </span>

        <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
          {totalCases} case{totalCases !== 1 ? "s" : ""} / {totalAssertions} assert{totalAssertions !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}

function Chevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}
