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

// 0784: install scope mirrors the `vskill install` CLI flags. project=local
// per-repo .claude/, user=~/.claude/, global=system agent dirs. Default = project.
type InstallScope = "project" | "user" | "global";

function scopeFlag(scope: InstallScope): string {
  if (scope === "global") return " --global";
  return ` --scope ${scope}`;
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
    });
    es.onerror = () => {
      clearTimeout(safetyTimer);
      try { es.close(); } catch { /* */ }
    };
  }, [installResult, publisher, slug, scope, onToast, handleCopy]);

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
                  {/* 0784: install scope picker — mirrors `vskill install` CLI
                      flags. Project = per-repo .claude/, User = ~/.claude/,
                      Global = system agent dirs. Default = project. */}
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
                    {(["project", "user", "global"] as const).map((s) => {
                      const checked = scope === s;
                      const description =
                        s === "project"
                          ? "Per-repo .claude/ — only this project"
                          : s === "user"
                            ? "~/.claude/ — every project on this account"
                            : "System agent dirs — every agent on this machine";
                      const label = s === "global" ? "Global" : s === "user" ? "User" : "Project";
                      return (
                        <button
                          key={s}
                          type="button"
                          role="radio"
                          aria-checked={checked}
                          data-testid={`skill-detail-install-scope-${s}`}
                          title={description}
                          onClick={() => setScope(s)}
                          style={{
                            padding: "0.25rem 0.6rem",
                            borderRadius: 4,
                            border: `1px solid ${checked ? "var(--text-primary, #191919)" : "var(--color-rule, #E8E1D6)"}`,
                            background: checked ? "var(--text-primary, #191919)" : "transparent",
                            color: checked ? "var(--bg-surface, #FFFFFF)" : "var(--text-secondary, #5A5651)",
                            cursor: "pointer",
                            fontFamily: "var(--font-mono, monospace)",
                            fontSize: "0.75rem",
                            fontWeight: checked ? 600 : 400,
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  {/* 0784: primary Install CTA above the terminal block. Shares
                      handleCopy with the per-variant Copy chips so behavior —
                      clipboard write of the canonical npm command, toast,
                      telemetry — is identical regardless of which button the
                      user picks. */}
                  <button
                    type="button"
                    onClick={handleInstall}
                    data-testid="skill-detail-install-primary"
                    aria-label="Install skill"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      marginBottom: "0.75rem",
                      padding: "0.5rem 1rem",
                      borderRadius: 6,
                      border: "1px solid var(--text-primary, #191919)",
                      background: "var(--text-primary, #191919)",
                      color: "var(--bg-surface, #FFFFFF)",
                      cursor: "pointer",
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: "0.875rem",
                      fontWeight: 600,
                    }}
                  >
                    Install
                  </button>
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
