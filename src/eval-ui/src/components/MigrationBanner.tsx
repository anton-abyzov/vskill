// ---------------------------------------------------------------------------
// MigrationBanner — one-shot import banner for legacy macOS Keychain users.
//
// 0702 US-006. The server detects old `vskill-<provider>` entries in the
// macOS Keychain and exposes three endpoints:
//
//   GET  /api/settings/migration-status      → { pending, darwinKeys? }
//   POST /api/settings/migration-perform     → { migrated: string[] }
//   POST /api/settings/migration-acknowledge → { ok: true }
//
// The banner renders at the top of the Settings modal. It is the one
// place in the UI that mentions "macOS Keychain" by name — users are
// entitled to see what legacy store we are migrating FROM. The
// settings-strings-guard test allow-lists this file.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";

export interface MigrationStatus {
  pending: boolean;
  darwinKeys?: string[];
}

type InternalState =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "visible"; darwinKeys: string[] }
  | { kind: "working" }
  | { kind: "error"; message: string };

export interface MigrationBannerProps {
  /** Called after a successful migrate, so parent can refresh listKeys(). */
  onMigrated?: (migrated: string[]) => void;
  /** Test hook — override fetch impl. */
  fetchImpl?: typeof fetch;
}

export function MigrationBanner({ onMigrated, fetchImpl }: MigrationBannerProps) {
  const [state, setState] = useState<InternalState>({ kind: "loading" });
  const doFetch = fetchImpl ?? globalThis.fetch;

  const load = useCallback(async () => {
    try {
      const resp = await doFetch("/api/settings/migration-status");
      if (!resp.ok) {
        setState({ kind: "hidden" });
        return;
      }
      const data = (await resp.json()) as MigrationStatus;
      if (data.pending && (data.darwinKeys?.length ?? 0) > 0) {
        setState({ kind: "visible", darwinKeys: data.darwinKeys ?? [] });
      } else {
        setState({ kind: "hidden" });
      }
    } catch {
      setState({ kind: "hidden" });
    }
  }, [doFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const migrate = useCallback(async () => {
    setState({ kind: "working" });
    try {
      const resp = await doFetch("/api/settings/migration-perform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!resp.ok) {
        setState({ kind: "error", message: `Migration failed (${resp.status})` });
        return;
      }
      const data = (await resp.json().catch(() => ({ migrated: [] }))) as {
        migrated: string[];
      };
      onMigrated?.(data.migrated ?? []);
      await load();
    } catch (err) {
      setState({ kind: "error", message: (err as Error).message });
    }
  }, [doFetch, load, onMigrated]);

  const dismiss = useCallback(async () => {
    setState({ kind: "hidden" });
    try {
      await doFetch("/api/settings/migration-acknowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
    } catch {
      // Silent — user intent honored locally; server ack is best-effort.
    }
  }, [doFetch]);

  if (state.kind === "loading" || state.kind === "hidden") return null;

  if (state.kind === "error") {
    return (
      <div
        role="status"
        data-testid="migration-banner"
        style={{
          padding: "10px 12px",
          borderRadius: 6,
          background: "color-mix(in srgb, var(--danger, #b33) 15%, transparent)",
          color: "var(--text-primary)",
          fontSize: 12,
          marginBottom: 12,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ flex: 1 }}>{state.message}</span>
        <button
          type="button"
          onClick={() => void load()}
          data-testid="migration-retry"
          style={bannerBtn}
        >
          Retry
        </button>
      </div>
    );
  }

  const working = state.kind === "working";

  return (
    <div
      role="note"
      data-testid="migration-banner"
      style={{
        padding: "10px 12px",
        borderRadius: 6,
        background: "color-mix(in srgb, var(--accent, var(--color-accent)) 12%, transparent)",
        color: "var(--text-primary)",
        fontSize: 12,
        marginBottom: 12,
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <div style={{ flex: 1 }}>
        <strong style={{ display: "block", marginBottom: 2 }}>
          Migrate from macOS Keychain
        </strong>
        <span style={{ color: "var(--text-muted, var(--text-tertiary))" }}>
          We found stored credentials from a previous vskill version. Import them
          into the new on-disk store.
        </span>
      </div>
      <button
        type="button"
        onClick={() => void migrate()}
        disabled={working}
        data-testid="migration-migrate"
        style={{
          ...bannerBtn,
          background: "var(--accent, var(--color-accent))",
          color: "white",
          opacity: working ? 0.6 : 1,
        }}
      >
        {working ? "Importing…" : "Migrate"}
      </button>
      <button
        type="button"
        onClick={() => void dismiss()}
        data-testid="migration-dismiss"
        style={{
          ...bannerBtn,
          background: "transparent",
          border: "none",
          color: "var(--text-muted, var(--text-tertiary))",
          textDecoration: "underline",
          padding: "4px 6px",
        }}
      >
        Dismiss for 30 days
      </button>
    </div>
  );
}

const bannerBtn: React.CSSProperties = {
  padding: "4px 10px",
  background: "var(--surface-2, transparent)",
  border: "1px solid var(--border-subtle)",
  borderRadius: 4,
  color: "var(--text-primary)",
  fontSize: 12,
  cursor: "pointer",
};
