// 0741 T-019..T-026: SkillDetailPanel — eval-ui detail overlay opened from
// the FindSkillsPalette `onSelect` callback.
//
// Responsibilities:
//   - T-020: Parallel fetches for skill metadata + versions (eval-server proxy).
//   - T-021: Hero with TrustBadge / TierBadge / RepoLink / RepoHealthBadge.
//   - T-022: Last 5 versions, newest first; default selection = latest.
//   - T-023: TerminalBlock install command, sanitized via ^[a-zA-Z0-9._@/-]+$.
//   - T-024: Copy → clipboard + toast (with execCommand fallback).
//   - T-025: Blocked-skill panel replaces install when isBlocked === true.
//   - T-026: "Back to results" link / Esc → restores palette + last-query.
//   - T-028: Fire-and-forget install-copy telemetry.
//   - T-029: Inline retry on 5xx / network errors.
//   - T-030: Focus trap + role="dialog" + focus restoration.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TrustBadge, { type TrustTier } from "./components/TrustBadge";
import TierBadge, { type CertificationTier } from "./components/TierBadge";
import { RepoLink } from "./components/RepoLink";
import RepoHealthBadge from "./components/RepoHealthBadge";
import TerminalBlock from "./components/TerminalBlock";
import { skillApiPath } from "../../lib/skill-url";
import { api, type InstallStateResponse } from "../../api";

// ---------------------------------------------------------------------------
// Types — minimal shape covering the platform's `/api/v1/skills/...` payload.
// We deliberately keep these loose so the eval-server proxy can pass through
// extra fields without breaking the panel.
// ---------------------------------------------------------------------------

export interface SelectedSkill {
  owner: string;
  repo: string;
  slug: string;
  displayName: string;
}

interface SkillMetadata {
  name?: string;
  displayName?: string;
  description?: string;
  trustTier?: TrustTier;
  certTier?: CertificationTier | string;
  repoUrl?: string;
  isBlocked?: boolean;
  blockReason?: string;
  isTainted?: boolean;
  ownerSlug?: string;
  repoSlug?: string;
  skillSlug?: string;
  publisher?: string;
}

interface SkillVersion {
  version: string;
  publishedAt?: string;
  authorEmail?: string;
  author?: string;
  isLatest?: boolean;
}

const DEFAULT_TELEMETRY_INSTALL_COPY = "/api/v1/studio/telemetry/install-copy";
const SKILL_NAME_REGEX = /^[a-zA-Z0-9._@/-]+$/;
const VERSION_REGEX = /^[a-zA-Z0-9._-]+$/;
const PLATFORM_URL = "https://verified-skill.com";

export interface SkillDetailPanelProps {
  selectedSkill: SelectedSkill;
  onClose: () => void;
  /** Override for tests. */
  apiBase?: string;
  /** Override the install-copy telemetry endpoint (tests). */
  telemetryInstallCopyUrl?: string;
  /** Toast dispatcher — defaults to `studio:toast` CustomEvent (existing contract). */
  onToast?: (message: string, kind: "success" | "error") => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fullName(s: SelectedSkill): string {
  return `${s.owner}/${s.repo}/${s.slug}`;
}

function publisherFromMetadata(meta: SkillMetadata | null, fallback: SelectedSkill): string {
  if (meta?.ownerSlug && meta?.repoSlug) return `${meta.ownerSlug}/${meta.repoSlug}`;
  if (meta?.publisher) return meta.publisher;
  return `${fallback.owner}/${fallback.repo}`;
}

interface InstallVariant {
  label: string;
  comment: string;
  command: string;
}

// 0827: install scope is binary in the UI — Project (this repo) or User
// (every detected agent tool's user-level dir). The previous third option
// "Global" was identical to User in terms of the underlying CLI invocation
// (`--global` fans out to all detected tools at the user level) but unclear
// to readers; collapsing the picker to two scopes makes the choice
// self-explanatory and the disabled-state reasoning per AC-US1-04 sound.
//
// Mapping to the displayed CLI flag (informational copy-command only):
//   project (UI) → ` --scope project`
//   user    (UI) → ` --global`
//
// AC-US1-02: the POST body to /api/studio/install-skill sends the literal
// scope value `"user"` — the server (install-skill-routes.ts) accepts
// project | user | global and maps "user" to `--scope user` internally.
type InstallScope = "project" | "user";

/** Render the visible CLI flag in the copy-command. User → ` --global`. */
function scopeFlag(scope: InstallScope): string {
  return scope === "user" ? " --global" : ` --scope ${scope}`;
}

function capitalize(s: InstallScope): string {
  return s === "user" ? "User" : "Project";
}

function buildInstallCommand(publisher: string, slug: string, version: string | null, scope: InstallScope): {
  ok: true;
  /** Canonical npm command — used by the primary Install button + Copy chip. */
  command: string;
  /** All 5 package-manager variants for display. */
  variants: InstallVariant[];
} | { ok: false; reason: string } {
  // Sanitize ALL identifier components — refuse to render the panel on any
  // mismatch (AC-US4-06). Matches the 0717 contract.
  const ident = version ? `${publisher}/${slug}@${version}` : `${publisher}/${slug}`;
  if (!SKILL_NAME_REGEX.test(`${publisher}/${slug}`)) {
    return { ok: false, reason: "Invalid skill identifier" };
  }
  if (version && !VERSION_REGEX.test(version)) {
    return { ok: false, reason: "Invalid version identifier" };
  }
  // 0784: render every common package-manager invocation so the user can pick
  // their flavor without having to translate. Canonical = npm (`npx`) — that's
  // what the primary Install button + Copy chip copy.
  const flag = scopeFlag(scope);
  const npmCmd = `npx vskill@latest install ${ident}${flag}`;
  const variants: InstallVariant[] = [
    { label: "npm", comment: "# npm", command: npmCmd },
    { label: "bun", comment: "# bun", command: `bunx vskill@latest install ${ident}${flag}` },
    { label: "pnpm", comment: "# pnpm", command: `pnpx vskill@latest install ${ident}${flag}` },
    { label: "yarn", comment: "# yarn", command: `yarn dlx vskill@latest install ${ident}${flag}` },
    {
      label: "alternative",
      comment: "# alternative (publisher + --skill flag)",
      command: version
        ? `npx vskill@latest install ${publisher}@${version} --skill ${slug}${flag}`
        : `npx vskill@latest install ${publisher} --skill ${slug}${flag}`,
    },
  ];
  return { ok: true, command: npmCmd, variants };
}

function dispatchToastFallback(message: string, kind: "success" | "error", durationMs: number) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("studio:toast", {
      detail: { message, kind, durationMs, severity: kind === "error" ? "error" : "info" },
    }),
  );
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand fallback.
    }
  }
  if (typeof document === "undefined") return false;
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function fireInstallCopyTelemetry(
  url: string,
  payload: { skillName: string; version: string; q: string; ts: number },
): void {
  try {
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => { /* fire-and-forget */ });
  } catch {
    /* never block clipboard or toast */
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SkillDetailPanel({
  selectedSkill,
  onClose,
  telemetryInstallCopyUrl = DEFAULT_TELEMETRY_INSTALL_COPY,
  onToast,
}: SkillDetailPanelProps) {
  const [meta, setMeta] = useState<SkillMetadata | null>(null);
  const [versions, setVersions] = useState<SkillVersion[]>([]);
  // 0819 AC-US5b-01..04: capture the platform's `unversioned: true` flag on
  // the /versions response so we can render "Discovered — no published
  // version yet (currentVersion: X)" instead of the misleading "No versions
  // found.". The flag is additive — only present on the orphan branch.
  const [unversioned, setUnversioned] = useState(false);
  const [unversionedCurrentVersion, setUnversionedCurrentVersion] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [scope, setScope] = useState<InstallScope>("project");
  // 0827: per-scope install-state (null = not yet loaded). Drives the scope
  // picker's disabled/checkmark state and the primary CTA's "Already
  // installed" affordance.
  const [installState, setInstallState] = useState<InstallStateResponse | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const backLinkRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const skillName = fullName(selectedSkill);

  // Capture the focus trigger so we can restore on close (T-030).
  useEffect(() => {
    triggerRef.current = (document.activeElement as HTMLElement | null) ?? null;
    return () => {
      const trig = triggerRef.current;
      if (trig && typeof trig.focus === "function") {
        try { trig.focus(); } catch { /* best-effort */ }
      }
    };
  }, []);

  // Focus the back link on mount (T-030 a11y).
  useEffect(() => {
    const t = setTimeout(() => backLinkRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  // Parallel fetches — T-020.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const metaUrl = skillApiPath(skillName);
    const versionsUrl = skillApiPath(skillName, "versions");
    Promise.all([
      fetch(metaUrl).then(async (res) => {
        if (!res.ok) throw new Error(`metadata ${res.status}`);
        return res.json() as Promise<SkillMetadata>;
      }),
      fetch(versionsUrl).then(async (res) => {
        if (!res.ok) throw new Error(`versions ${res.status}`);
        const body = await res.json();
        // Support both `{ versions: [] }` and bare arrays. 0819: also
        // capture `unversioned` + `currentVersion` from the orphan-branch
        // payload (additive — absent on the happy path).
        const list: SkillVersion[] = Array.isArray(body)
          ? (body as SkillVersion[])
          : ((body?.versions as SkillVersion[]) ?? []);
        const isUnversioned = !Array.isArray(body) && body?.unversioned === true;
        const orphanCurrent = !Array.isArray(body) && typeof body?.currentVersion === "string"
          ? (body.currentVersion as string)
          : null;
        return { list, unversioned: isUnversioned, currentVersion: orphanCurrent };
      }),
    ])
      .then(([metaResp, versionsResp]) => {
        if (cancelled) return;
        setMeta(metaResp);
        setVersions(versionsResp.list);
        setUnversioned(versionsResp.unversioned);
        setUnversionedCurrentVersion(versionsResp.currentVersion);
        // Default selection = latest published (`isLatest` if marked, else first).
        const latest = versionsResp.list.find((v) => v.isLatest) ?? versionsResp.list[0] ?? null;
        setSelectedVersion(latest ? latest.version : null);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [skillName, retryNonce]);

  // 0827 — install-state lookup runs alongside the meta/versions fetches but
  // does NOT gate the loading spinner. Older eval-servers without the route
  // soft-fail to null and the picker degrades to its pre-0827 behavior (AC-US3-04).
  // A separate effect (instead of bundling into Promise.all above) keeps first
  // paint independent of this lookup and preserves the existing T-020 loading
  // contract.
  useEffect(() => {
    let cancelled = false;
    api.getSkillInstallState(skillName).then(
      (resp) => { if (!cancelled) setInstallState(resp); },
      () => {
        if (cancelled) return;
        // AC-US3-04: leave installState null (drives optimistic "not installed"
        // rendering). Warn once per session via sessionStorage — the same panel
        // can mount many times in a session, but each warning would be noise.
        try {
          const KEY = "vskill:installState:warned";
          if (typeof sessionStorage !== "undefined" && !sessionStorage.getItem(KEY)) {
            sessionStorage.setItem(KEY, "1");
            console.warn("[SkillDetailPanel] install-state fetch failed; falling back to optimistic not-installed UX");
          }
        } catch {
          // sessionStorage may be unavailable (private mode, jsdom edge cases).
          // Swallow — the warn-once guard is best-effort.
        }
        setInstallState(null);
      },
    );
    return () => { cancelled = true; };
  }, [skillName, retryNonce]);

  // 0827 — re-fetch install-state when an install completes elsewhere in the
  // app (handleInstall dispatches `studio:skill-installed` on success). This
  // lets the panel auto-flip from "Install" to "Installed" without forcing
  // the user to close + reopen the dialog. Debounced 50ms to coalesce the
  // event firing alongside the SSE done-frame.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onInstalled = (e: Event) => {
      const detail = (e as CustomEvent).detail as { skill?: string } | null;
      if (!detail?.skill || detail.skill !== skillName) {
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        api.getSkillInstallState(skillName).then(
          (next) => setInstallState(next),
          () => { /* silent — keep prior state */ },
        );
      }, 50);
    };
    window.addEventListener("studio:skill-installed", onInstalled as EventListener);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("studio:skill-installed", onInstalled as EventListener);
    };
  }, [skillName]);

  // Esc closes — restores the palette via onClose. The shell re-opens the
  // palette pre-filled with sessionStorage["find-skills:last-query"] (the
  // FindSkillsPalette persists this on every onSelect, T-014).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        handleBack();
      } else if (e.key === "Tab") {
        // Minimal focus trap (T-030) — keep Tab cycles inside the dialog.
        const root = dialogRef.current;
        if (!root) return;
        const focusables = root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const handleBack = useCallback(() => {
    onClose();
    // Re-open the palette with the previous query (T-026, AC-US4-08).
    let lastQuery = "";
    try {
      if (typeof window !== "undefined" && window.sessionStorage) {
        lastQuery = window.sessionStorage.getItem("find-skills:last-query") ?? "";
      }
    } catch { /* storage failure non-fatal */ }
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("openFindSkills", { detail: { query: lastQuery } }),
      );
    }
  }, [onClose]);

  const publisher = publisherFromMetadata(meta, selectedSkill);
  const slug = meta?.skillSlug ?? selectedSkill.slug;
  const displayName = meta?.displayName ?? selectedSkill.displayName ?? slug;
  const isBlocked = meta?.isBlocked === true;

  // Top-5 versions, newest first. We assume the API already sorts; if not,
  // a stable sort on publishedAt descending is a safe fallback.
  const topVersions = useMemo(() => {
    if (versions.length === 0) return [];
    const sorted = [...versions].sort((a, b) => {
      const ad = a.publishedAt ? Date.parse(a.publishedAt) : 0;
      const bd = b.publishedAt ? Date.parse(b.publishedAt) : 0;
      return bd - ad;
    });
    return sorted.slice(0, 5);
  }, [versions]);

  const isLatestSelected = useMemo(() => {
    if (!selectedVersion || topVersions.length === 0) return true;
    return topVersions[0].version === selectedVersion;
  }, [selectedVersion, topVersions]);

  const installResult = useMemo(() => {
    if (!selectedVersion) return null;
    return buildInstallCommand(publisher, slug, isLatestSelected ? null : selectedVersion, scope);
  }, [publisher, slug, selectedVersion, isLatestSelected, scope]);

  const handleCopy = useCallback(async () => {
    if (!installResult || !installResult.ok) return;
    const ok = await copyToClipboard(installResult.command);
    // T-028: fire-and-forget telemetry — must NOT block clipboard or toast.
    fireInstallCopyTelemetry(telemetryInstallCopyUrl, {
      skillName,
      version: selectedVersion ?? "",
      q: "",
      ts: Date.now(),
    });
    const message = ok
      ? `Run ${installResult.command} in your terminal`
      : "Copy failed — please copy the command manually.";
    if (onToast) {
      try { onToast(message, ok ? "success" : "error"); } catch { /* hook failure non-fatal */ }
    } else {
      dispatchToastFallback(message, ok ? "success" : "error", 3500);
    }
  }, [installResult, telemetryInstallCopyUrl, skillName, selectedVersion, publisher, slug, isLatestSelected, onToast]);

  // 0784 hotfix — primary Install button actually runs the install via the
  // localhost-only POST /api/studio/install-skill endpoint, then streams
  // progress over SSE. Falls back to copy-to-clipboard if the endpoint is
  // unavailable (e.g. the verified-skill.com proxy where there is no local
  // shell).
  const handleInstall = useCallback(async () => {
    if (!installResult || !installResult.ok) return;
    const target = `${publisher}/${slug}`;
    if (onToast) {
      try { onToast(`Installing ${target}…`, "info"); } catch { /* non-fatal */ }
    } else {
      dispatchToastFallback(`Installing ${target}…`, "info", 5000);
    }
    let jobId: string | null = null;
    try {
      const res = await fetch("/api/studio/install-skill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 0827 AC-US1-02: send the literal UI scope ("project" | "user").
        // Server's VALID_SCOPES accepts both — buildArgs maps "user" to
        // `--scope user`. The displayed copy-command still shows ` --global`
        // for the User choice (informational only).
        body: JSON.stringify({ skill: target, scope }),
      });
      if (res.status === 404) {
        // Endpoint not present (older eval-server, or browser is talking to
        // the verified-skill.com proxy) — fall back to copy-to-clipboard.
        return handleCopy();
      }
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        const msg = errBody.error || `Install failed (HTTP ${res.status})`;
        if (onToast) {
          try { onToast(msg, "error"); } catch { /* non-fatal */ }
        } else {
          dispatchToastFallback(msg, "error", 6000);
        }
        return;
      }
      const body = (await res.json()) as { jobId?: string };
      jobId = body?.jobId ?? null;
    } catch {
      // Network failure — fall back to copy-to-clipboard so the user can
      // still install manually.
      return handleCopy();
    }
    if (!jobId) return;

    // Stream progress + final status. Server uses SSE; we read it as text
    // chunks via the EventSource API — falls back gracefully if absent.
    if (typeof EventSource === "undefined") return;
    const es = new EventSource(`/api/studio/install-skill/${jobId}/stream`);
    const TIMEOUT_MS = 200_000;
    const safetyTimer = setTimeout(() => { try { es.close(); } catch { /* */ } }, TIMEOUT_MS);
    es.addEventListener("done", (ev) => {
      clearTimeout(safetyTimer);
      try { es.close(); } catch { /* */ }
      let parsed: { success?: boolean; stderr?: string } = {};
      try { parsed = JSON.parse((ev as MessageEvent).data); } catch { /* */ }
      const okFinal = parsed.success === true;
      const finalMsg = okFinal
        ? `Installed ${target} (${scope})`
        : `Install failed: ${parsed.stderr?.trim().split(/\r?\n/).slice(-1)[0] || "see terminal"}`;
      if (onToast) {
        try { onToast(finalMsg, okFinal ? "success" : "error"); } catch { /* non-fatal */ }
      } else {
        dispatchToastFallback(finalMsg, okFinal ? "success" : "error", okFinal ? 4000 : 8000);
      }
      // 0826: dismiss the dialog after a successful install. The user has
      // their toast confirmation and the panel has nothing more to do —
      // staying open looked like the install was still in progress. We also
      // broadcast `studio:skill-installed` so installed-skill listings refresh
      // immediately. Failures keep the dialog open so the user can read the
      // error and decide whether to copy the manual command.
      if (okFinal) {
        if (typeof window !== "undefined") {
          try {
            window.dispatchEvent(
              new CustomEvent("studio:skill-installed", { detail: { skill: target, scope } }),
            );
          } catch { /* non-fatal */ }
        }
        handleBack();
      }
    });
    es.onerror = () => {
      clearTimeout(safetyTimer);
      try { es.close(); } catch { /* */ }
    };
  }, [installResult, publisher, slug, scope, onToast, handleCopy, handleBack]);

  const trustTier: TrustTier = (meta?.trustTier as TrustTier | undefined) ?? "T1";
  const certTier: CertificationTier =
    meta?.certTier === "CERTIFIED" || meta?.certTier === "VERIFIED"
      ? (meta.certTier as CertificationTier)
      : "VERIFIED";

  return (
    <div
      ref={dialogRef}
      data-testid="skill-detail-panel"
      role="dialog"
      aria-modal="true"
      aria-label={`Skill detail — ${displayName}`}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9998,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "min(10vh, 80px)",
      }}
      onClick={(e) => {
        // Click on the backdrop closes — clicks inside the panel stop propagation.
        if (e.target === e.currentTarget) handleBack();
      }}
    >
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          backdropFilter: "blur(4px)",
        }}
      />
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 720,
          margin: "0 1rem",
          background: "var(--bg-surface, #FFFFFF)",
          color: "var(--text-primary, #191919)",
          borderRadius: "8px",
          border: "1px solid var(--color-rule, #E8E1D6)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
          overflow: "hidden",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header — Back link + Esc kbd */}
        <div
          style={{
            padding: "0.75rem 1rem",
            borderBottom: "1px solid var(--color-rule, #E8E1D6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <button
            ref={backLinkRef}
            type="button"
            onClick={handleBack}
            data-testid="skill-detail-back"
            style={{
              background: "transparent",
              border: "none",
              padding: "4px 8px",
              borderRadius: 4,
              cursor: "pointer",
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 12,
              color: "var(--text-secondary, #5A5651)",
            }}
          >
            ← Back to results
          </button>
          <kbd
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 11,
              color: "var(--text-secondary, #5A5651)",
              border: "1px solid var(--color-rule, #E8E1D6)",
              borderRadius: 4,
              padding: "1px 5px",
            }}
          >
            Esc
          </kbd>
        </div>

        <div style={{ overflowY: "auto", padding: "1rem", flex: 1 }}>
          {loading && (
            <div data-testid="skill-detail-loading" style={{ padding: "2rem", textAlign: "center", color: "var(--text-secondary, #5A5651)" }}>
              Loading…
            </div>
          )}

          {error && !loading && (
            <div
              data-testid="skill-detail-error"
              style={{
                padding: "1.5rem",
                textAlign: "center",
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "0.875rem",
                color: "var(--red, #b54444)",
              }}
            >
              <div style={{ marginBottom: "0.75rem" }}>Failed to load skill: {error}</div>
              <button
                data-testid="skill-detail-retry"
                onClick={() => setRetryNonce((n) => n + 1)}
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: "0.8125rem",
                  padding: "0.4rem 1rem",
                  borderRadius: 4,
                  border: "1px solid var(--color-rule, #E8E1D6)",
                  background: "transparent",
                  color: "var(--text-primary, #191919)",
                  cursor: "pointer",
                }}
              >
                Retry
              </button>
            </div>
          )}

          {!loading && !error && (
            <>
              {/* Hero — T-021 */}
              <section data-testid="skill-detail-hero" style={{ marginBottom: "1.25rem" }}>
                <h2 style={{ margin: "0 0 0.5rem", fontSize: "1.25rem", fontWeight: 600 }}>
                  {displayName}
                </h2>
                {meta?.description && (
                  <p style={{ margin: "0 0 0.75rem", color: "var(--text-secondary, #5A5651)", fontSize: "0.875rem", lineHeight: 1.5 }}>
                    {meta.description}
                  </p>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
                  <TrustBadge tier={trustTier} />
                  <TierBadge tier={certTier} isTainted={meta?.isTainted} />
                  <RepoLink repoUrl={meta?.repoUrl ?? null} />
                  <RepoHealthBadge skillName={skillName} repoUrl={meta?.repoUrl} />
                </div>
              </section>

              {/* Versions — T-022 */}
              <section data-testid="skill-detail-versions" style={{ marginBottom: "1.25rem" }}>
                <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.8125rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-secondary, #5A5651)" }}>
                  Versions
                </h3>
                {topVersions.length === 0 ? (
                  unversioned ? (
                    // 0819 AC-US5b-01..03: skill exists but has zero
                    // SkillVersions — surface this distinctly so the user
                    // understands the skill is real but not yet published.
                    <div
                      data-testid="skill-detail-unversioned"
                      style={{ color: "var(--text-secondary, #5A5651)", fontSize: "0.8125rem" }}
                    >
                      Discovered — no published version yet (currentVersion: {unversionedCurrentVersion ?? "unknown"}).
                    </div>
                  ) : (
                    <div
                      data-testid="skill-detail-no-versions"
                      style={{ color: "var(--text-secondary, #5A5651)", fontSize: "0.8125rem" }}
                    >
                      No versions found.
                    </div>
                  )
                ) : (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                    {topVersions.map((v) => {
                      const selected = v.version === selectedVersion;
                      const date = v.publishedAt ? v.publishedAt.slice(0, 10) : "";
                      const author = v.authorEmail ?? v.author ?? "";
                      return (
                        <li key={v.version}>
                          <button
                            type="button"
                            data-testid="skill-detail-version-row"
                            data-version={v.version}
                            data-selected={selected ? "true" : "false"}
                            aria-pressed={selected}
                            onClick={() => setSelectedVersion(v.version)}
                            style={{
                              width: "100%",
                              textAlign: "left",
                              padding: "0.5rem 0.75rem",
                              borderRadius: 4,
                              border: selected ? "1px solid var(--color-action, #2F5B8E)" : "1px solid var(--color-rule, #E8E1D6)",
                              background: selected ? "color-mix(in srgb, var(--color-action, #2F5B8E) 8%, transparent)" : "transparent",
                              cursor: "pointer",
                              fontFamily: "var(--font-mono, monospace)",
                              fontSize: "0.8125rem",
                              color: "var(--text-primary, #191919)",
                              display: "flex",
                              alignItems: "center",
                              gap: "0.5rem",
                            }}
                          >
                            <span aria-hidden="true" style={{ width: 14, display: "inline-flex", justifyContent: "center" }}>
                              {selected ? "●" : "○"}
                            </span>
                            <span style={{ fontWeight: 600 }}>v{v.version}</span>
                            {date && <span style={{ color: "var(--text-secondary, #5A5651)" }}>· {date}</span>}
                            {author && <span style={{ color: "var(--text-secondary, #5A5651)" }}>· {author}</span>}
                            {selected && (
                              <span data-testid="skill-detail-version-selected-tag" style={{ marginLeft: "auto", fontSize: "0.6875rem", color: "var(--color-action, #2F5B8E)" }}>
                                Selected
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div style={{ marginTop: "0.5rem", textAlign: "right" }}>
                  <a
                    data-testid="skill-detail-see-all-versions"
                    href={`${PLATFORM_URL}/skills/${selectedSkill.owner}/${selectedSkill.repo}/${selectedSkill.slug}/versions`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.75rem", color: "var(--color-action, #2F5B8E)", textDecoration: "none" }}
                  >
                    see all versions →
                  </a>
                </div>
              </section>

              {/* Install or Blocked panel — T-023 / T-025 */}
              {isBlocked ? (
                <section data-testid="skill-detail-blocked" style={{ marginBottom: "0.5rem" }}>
                  <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.8125rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--red, #b54444)" }}>
                    This skill is blocked
                  </h3>
                  <div
                    style={{
                      padding: "1rem",
                      borderRadius: 6,
                      border: "1px solid var(--red, #b54444)",
                      background: "var(--red-muted, color-mix(in srgb, #b54444 18%, transparent))",
                      color: "var(--red, #b54444)",
                      fontSize: "0.875rem",
                    }}
                  >
                    {meta?.blockReason ?? "This skill has been blocked by platform moderators and cannot be installed."}
                  </div>
                </section>
              ) : installResult && !installResult.ok ? (
                <section data-testid="skill-detail-install-error" style={{ marginBottom: "0.5rem" }}>
                  <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.8125rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--red, #b54444)" }}>
                    Install command unavailable
                  </h3>
                  <div
                    style={{
                      padding: "1rem",
                      borderRadius: 6,
                      border: "1px solid var(--red, #b54444)",
                      background: "var(--red-muted, color-mix(in srgb, #b54444 18%, transparent))",
                      color: "var(--red, #b54444)",
                      fontSize: "0.875rem",
                    }}
                  >
                    {installResult.reason} — refusing to render the install panel for safety.
                  </div>
                </section>
              ) : installResult && installResult.ok ? (
                <section data-testid="skill-detail-install" style={{ marginBottom: "0.5rem" }}>
                  <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.8125rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-secondary, #5A5651)" }}>
                    Install
                  </h3>
                  {/* 0827: two-scope picker (Project | User). Each pill
                      reflects per-scope install-state from
                      /api/studio/install-state — installed scopes are
                      disabled with a checkmark + tooltip explaining where
                      it's installed and how to remove it. Tooltip on User
                      lists the detected agent tools that will receive the
                      install (drives transparency for the `--global`
                      fan-out). */}
                  <div
                    role="radiogroup"
                    aria-label="Install scope"
                    data-testid="skill-detail-install-scope"
                    style={{
                      display: "flex",
                      gap: "0.5rem",
                      alignItems: "center",
                      marginBottom: "0.75rem",
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: "0.75rem",
                      color: "var(--text-secondary, #5A5651)",
                    }}
                  >
                    <span>Scope:</span>
                    {(["project", "user"] as const).map((s) => {
                      const checked = scope === s;
                      const scopeState = installState?.scopes?.[s];
                      const isInstalled = scopeState?.installed === true;
                      const detectedList = installState?.detectedAgentTools ?? [];
                      // Build the destinations list once; project entries are
                      // prefixed with "./" to match the spec FR-003 contract.
                      const projectDests = detectedList.map((a) => `./${a.localDir}`).join(", ");
                      const userDests = detectedList.map((a) => a.globalDir).join(", ");
                      const installedTools = scopeState?.installedAgentTools ?? [];
                      // AC-US2-06/07: disabled tooltip is `Installed v<v> · <ids>`;
                      // omit the version segment when the lockfile entry has no
                      // recorded version.
                      const installedTooltip = scopeState?.version
                        ? `Installed v${scopeState.version} · ${installedTools.join(", ")}`
                        : `Installed · ${installedTools.join(", ")}`;
                      // AC-US1-04 / AC-US1-05: enabled tooltip lists the per-tool
                      // destinations the install will touch. Falls back to a
                      // generic copy when detection hasn't loaded yet.
                      const enabledTooltip = s === "project"
                        ? (projectDests ? `Will install to: ${projectDests}` : `Install with --scope project`)
                        : (userDests ? `Will install to: ${userDests}` : `Install with --global`);
                      const title = isInstalled ? installedTooltip : enabledTooltip;
                      const label = capitalize(s);
                      return (
                        <button
                          key={s}
                          type="button"
                          role="radio"
                          aria-checked={checked}
                          aria-disabled={isInstalled}
                          disabled={isInstalled}
                          data-testid={`skill-detail-install-scope-${s}`}
                          data-installed={isInstalled ? "true" : "false"}
                          title={title}
                          onClick={() => { if (!isInstalled) setScope(s); }}
                          style={{
                            padding: "0.25rem 0.6rem",
                            borderRadius: 4,
                            border: `1px solid ${checked ? "var(--text-primary, #191919)" : "var(--color-rule, #E8E1D6)"}`,
                            background: checked ? "var(--text-primary, #191919)" : "transparent",
                            color: checked ? "var(--bg-surface, #FFFFFF)" : "var(--text-secondary, #5A5651)",
                            cursor: isInstalled ? "not-allowed" : "pointer",
                            opacity: isInstalled ? 0.55 : 1,
                            fontFamily: "var(--font-mono, monospace)",
                            fontSize: "0.75rem",
                            fontWeight: checked ? 600 : 400,
                          }}
                        >
                          {isInstalled ? `Installed ✓ ${label}` : label}
                        </button>
                      );
                    })}
                  </div>
                  {/* 0784: primary Install CTA above the terminal block. Shares
                      handleCopy with the per-variant Copy chips so behavior —
                      clipboard write of the canonical npm command, toast,
                      telemetry — is identical regardless of which button the
                      user picks. */}
                  {(() => {
                    // 0827 — disable the primary CTA when the currently
                    // selected scope already has the skill installed. The
                    // copy of the button + its tooltip explain *why* it's
                    // disabled, so the user can switch scope or use the
                    // (CLI-only) uninstall path instead.
                    const selectedState = installState?.scopes?.[scope];
                    const isInstalledSelected = selectedState?.installed === true;
                    const versionSuffix = selectedState?.version ? ` (v${selectedState.version})` : "";
                    // AC-US2-08: literal tooltip copy from spec — verbatim so
                    // the test assertion `/Already installed at (project|user) — re-run via CLI to force/`
                    // matches.
                    const installedTooltip = `Already installed at ${scope} — re-run via CLI to force`;
                    return (
                      <button
                        type="button"
                        onClick={handleInstall}
                        disabled={isInstalledSelected}
                        aria-disabled={isInstalledSelected}
                        data-testid="skill-detail-install-primary"
                        data-installed={isInstalledSelected ? "true" : "false"}
                        aria-label={isInstalledSelected ? "Already installed at the selected scope" : "Install skill"}
                        title={isInstalledSelected ? installedTooltip : undefined}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          marginBottom: "0.75rem",
                          padding: "0.5rem 1rem",
                          borderRadius: 6,
                          border: "1px solid var(--text-primary, #191919)",
                          background: isInstalledSelected ? "var(--bg-surface, #FFFFFF)" : "var(--text-primary, #191919)",
                          color: isInstalledSelected ? "var(--text-secondary, #5A5651)" : "var(--bg-surface, #FFFFFF)",
                          cursor: isInstalledSelected ? "not-allowed" : "pointer",
                          opacity: isInstalledSelected ? 0.7 : 1,
                          fontFamily: "var(--font-mono, monospace)",
                          fontSize: "0.875rem",
                          fontWeight: 600,
                        }}
                      >
                        {isInstalledSelected ? `✓ Installed${versionSuffix}` : "Install"}
                      </button>
                    );
                  })()}
                  {/* 0784: render every common package-manager variant so the
                      user picks their flavor without translating. Each row
                      shows a "# label" comment, the `$ command`, and a Copy
                      chip targeted to that single variant. */}
                  <div data-testid="skill-detail-install-command" style={{ display: "block" }}>
                    <TerminalBlock compact>
                      {installResult.variants.map((v, i) => (
                        <div
                          key={v.label}
                          data-testid={`skill-detail-install-variant-${v.label}`}
                          style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start", marginTop: i === 0 ? 0 : "0.75rem" }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: "#8B949E", marginBottom: "0.125rem" }}>{v.comment}</div>
                            <div>
                              <span style={{ color: "#8B949E", marginRight: "0.5rem" }}>$</span>
                              <span data-testid={`skill-detail-install-variant-cmd-${v.label}`}>{v.command}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={async () => {
                              const ok = await copyToClipboard(v.command);
                              const message = ok
                                ? `Run ${v.command} in your terminal`
                                : "Copy failed — please copy the command manually.";
                              if (onToast) {
                                try { onToast(message, ok ? "success" : "error"); } catch { /* hook failure non-fatal */ }
                              } else {
                                dispatchToastFallback(message, ok ? "success" : "error", 3500);
                              }
                              if (ok) {
                                fireInstallCopyTelemetry(telemetryInstallCopyUrl, {
                                  skillName,
                                  version: selectedVersion ?? "",
                                  q: "",
                                  ts: Date.now(),
                                });
                              }
                            }}
                            data-testid={`skill-detail-copy-${v.label}`}
                            aria-label={`Copy ${v.label} install command`}
                            style={{
                              flexShrink: 0,
                              padding: "0.25rem 0.6rem",
                              borderRadius: 4,
                              border: "1px solid color-mix(in srgb, #E6EDF3 25%, transparent)",
                              background: "color-mix(in srgb, #E6EDF3 8%, transparent)",
                              color: "#E6EDF3",
                              cursor: "pointer",
                              fontFamily: "var(--font-mono, monospace)",
                              fontSize: "0.7rem",
                              alignSelf: "flex-end",
                            }}
                          >
                            Copy
                          </button>
                        </div>
                      ))}
                    </TerminalBlock>
                  </div>
                </section>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default SkillDetailPanel;
