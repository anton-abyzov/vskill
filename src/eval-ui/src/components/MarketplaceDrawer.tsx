// ---------------------------------------------------------------------------
// 0700 phase 2B: MarketplaceDrawer
//
// Right-side slide-in drawer that lists configured Claude Code marketplaces
// and, when you click one, shows its available plugins. Each plugin row has
// an "Install" button that kicks off /api/plugins/install/stream and pipes
// the progress into an InstallProgressToast (phase 2C).
//
// Data flow:
//   GET  /api/plugins/marketplaces          → list of { name, source }
//   GET  /api/plugins/marketplaces/:name    → { name, description, plugins[] }
//   POST /api/plugins/install/stream        → SSE stream of stdout lines
//   POST /api/plugins/marketplaces          → add a marketplace (proxies claude plugin marketplace add)
//
// Keeps the drawer focused on browse+install; enable/disable/uninstall stay
// on the sidebar's PluginActionMenu so there's only one place to manage an
// already-installed plugin.
// ---------------------------------------------------------------------------

import * as React from "react";
import { mutate as swrMutate } from "../hooks/useSWR";

export interface MarketplaceSummary {
  name: string;
  source: string;
}

export interface MarketplacePlugin {
  name: string;
  description: string;
  version: string;
  category: string;
  author: string;
}

export interface MarketplaceDetail {
  name: string;
  description: string;
  plugins: MarketplacePlugin[];
}

export interface MarketplaceDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Invoked with { plugin, marketplace } so the parent can kick off SSE. */
  onInstall: (plugin: string, marketplace: string) => void;
  /** Names of already-installed plugins — so rows can show an "Installed" chip. */
  installedNames: Set<string>;
}

export function MarketplaceDrawer({
  open,
  onClose,
  onInstall,
  installedNames,
}: MarketplaceDrawerProps): React.ReactElement | null {
  const [marketplaces, setMarketplaces] = React.useState<MarketplaceSummary[]>([]);
  const [selectedName, setSelectedName] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<MarketplaceDetail | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Load marketplaces on open
  React.useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    fetch("/api/plugins/marketplaces")
      .then((r) => r.json())
      .then((body: { marketplaces?: MarketplaceSummary[]; error?: string }) => {
        if (body.error) throw new Error(body.error);
        setMarketplaces(body.marketplaces ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [open]);

  // Load selected marketplace detail
  React.useEffect(() => {
    if (!selectedName) {
      setDetail(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`/api/plugins/marketplaces/${encodeURIComponent(selectedName)}`)
      .then((r) => r.json())
      .then((body: MarketplaceDetail & { error?: string }) => {
        if (body.error) throw new Error(body.error);
        setDetail(body);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [selectedName]);

  // Esc to close
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Plugin marketplace"
      data-vskill-marketplace-drawer
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
      }}
    >
      <div
        onClick={onClose}
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.38)" }}
      />
      <aside
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(480px, 94vw)",
          background: "var(--color-paper, #fff)",
          borderLeft: "1px solid var(--border-default, rgba(0,0,0,0.12))",
          boxShadow: "-10px 0 30px -8px rgba(0,0,0,0.18)",
          display: "flex",
          flexDirection: "column",
          fontFamily: "var(--font-sans)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 18px",
            borderBottom: "1px solid var(--border-subtle, rgba(0,0,0,0.08))",
          }}
        >
          {selectedName && (
            <button
              type="button"
              onClick={() => setSelectedName(null)}
              aria-label="Back to marketplaces"
              style={{
                border: "none",
                background: "transparent",
                fontSize: 14,
                color: "var(--text-secondary)",
                cursor: "pointer",
                padding: 0,
              }}
            >
              ← Back
            </button>
          )}
          <h2
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 600,
              color: "var(--text-primary)",
              fontFamily: "var(--font-serif, ui-serif)",
              flex: 1,
            }}
          >
            {selectedName ? detail?.name ?? selectedName : "Browse plugins"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              border: "none",
              background: "transparent",
              fontSize: 16,
              color: "var(--text-secondary)",
              cursor: "pointer",
              padding: "4px 6px",
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
          {loading && (
            <div style={{ padding: 12, fontSize: 12, color: "var(--text-tertiary)" }}>
              Loading…
            </div>
          )}
          {error && (
            <div
              style={{
                padding: 10,
                fontSize: 12,
                color: "var(--color-error, #b91c1c)",
                background: "color-mix(in oklch, var(--color-error, #b91c1c) 8%, transparent)",
                borderRadius: 4,
              }}
            >
              {error}
            </div>
          )}

          {/* Marketplace list */}
          {!selectedName && !loading && marketplaces.length === 0 && !error && (
            <EmptyMarketplaces />
          )}
          {!selectedName &&
            marketplaces.map((m) => (
              <button
                key={m.name}
                type="button"
                onClick={() => setSelectedName(m.name)}
                style={rowButtonStyle}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--surface-2, rgba(0,0,0,0.04))";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                  {m.name}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-tertiary)",
                    fontFamily: "var(--font-mono)",
                    marginTop: 2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {m.source}
                </div>
              </button>
            ))}

          {/* Marketplace detail → plugin list */}
          {selectedName && detail && (
            <>
              {detail.description && (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-secondary)",
                    padding: "0 6px 12px",
                    lineHeight: 1.5,
                  }}
                >
                  {detail.description}
                </div>
              )}
              {detail.plugins.length === 0 && (
                <div style={{ padding: 12, fontSize: 12, color: "var(--text-tertiary)" }}>
                  This marketplace has no plugins catalogued yet.
                </div>
              )}
              {detail.plugins.map((p) => {
                const installed = installedNames.has(p.name);
                return (
                  <div key={p.name} style={{ padding: "10px 8px", borderBottom: "1px solid var(--border-subtle, rgba(0,0,0,0.05))" }}>
                    <div style={{ display: "flex", alignItems: "start", gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: "var(--text-primary)",
                            display: "flex",
                            alignItems: "baseline",
                            gap: 8,
                          }}
                        >
                          {p.name}
                          {p.version && (
                            <span
                              style={{
                                fontFamily: "var(--font-mono)",
                                fontSize: 10,
                                color: "var(--text-tertiary)",
                              }}
                            >
                              {p.version}
                            </span>
                          )}
                          {p.category && (
                            <span
                              style={{
                                fontSize: 10,
                                padding: "1px 6px",
                                borderRadius: 10,
                                background: "var(--surface-2, rgba(0,0,0,0.05))",
                                color: "var(--text-secondary)",
                              }}
                            >
                              {p.category}
                            </span>
                          )}
                        </div>
                        {p.description && (
                          <div
                            style={{
                              fontSize: 11,
                              color: "var(--text-secondary)",
                              marginTop: 4,
                              lineHeight: 1.5,
                            }}
                          >
                            {p.description}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={installed}
                        onClick={() => onInstall(p.name, selectedName)}
                        style={{
                          flexShrink: 0,
                          padding: "5px 12px",
                          fontSize: 12,
                          fontWeight: 500,
                          border: "none",
                          borderRadius: 4,
                          background: installed
                            ? "var(--surface-2, rgba(0,0,0,0.05))"
                            : "var(--color-accent, #2f6f8f)",
                          color: installed ? "var(--text-tertiary)" : "var(--color-paper, #fff)",
                          cursor: installed ? "default" : "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        {installed ? "Installed" : "Install"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Footer: add marketplace */}
        {!selectedName && (
          <div
            style={{
              borderTop: "1px solid var(--border-subtle, rgba(0,0,0,0.08))",
              padding: 12,
            }}
          >
            <AddMarketplaceForm
              onAdded={() => {
                swrMutate("marketplaces");
                // Refetch the list
                fetch("/api/plugins/marketplaces")
                  .then((r) => r.json())
                  .then((body: { marketplaces?: MarketplaceSummary[] }) =>
                    setMarketplaces(body.marketplaces ?? []),
                  );
              }}
            />
          </div>
        )}
      </aside>
    </div>
  );
}

function EmptyMarketplaces(): React.ReactElement {
  return (
    <div
      style={{
        padding: 20,
        fontSize: 12,
        color: "var(--text-tertiary)",
        lineHeight: 1.6,
      }}
    >
      No marketplaces configured yet. Add one below — examples:
      <ul style={{ marginTop: 8, paddingLeft: 16 }}>
        <li><code>anthropics/claude-plugins-official</code></li>
        <li><code>openai/codex-plugin-cc</code></li>
      </ul>
    </div>
  );
}

function AddMarketplaceForm({ onAdded }: { onAdded: () => void }): React.ReactElement {
  const [source, setSource] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(): Promise<void> {
    const trimmed = source.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      // We proxy to `claude plugin marketplace add <source>` — reuse the
      // existing install endpoint shape with a different path if exposed;
      // else fall back to a dedicated route.
      const res = await fetch("/api/plugins/marketplaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: trimmed }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setError(body.error ?? `Add failed (${res.status})`);
        return;
      }
      setSource("");
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 11, color: "var(--text-tertiary)", fontWeight: 500 }}>
        Add marketplace (GitHub owner/repo, URL, or path)
      </label>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          type="text"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void onSubmit();
          }}
          placeholder="anthropics/claude-plugins-official"
          disabled={busy}
          style={{
            flex: 1,
            padding: "6px 8px",
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            border: "1px solid var(--border-default, rgba(0,0,0,0.12))",
            borderRadius: 4,
            background: "var(--surface-0, #fff)",
            color: "var(--text-primary)",
            outline: "none",
          }}
        />
        <button
          type="button"
          onClick={() => void onSubmit()}
          disabled={busy || !source.trim()}
          style={{
            padding: "6px 14px",
            fontSize: 12,
            fontWeight: 500,
            border: "none",
            borderRadius: 4,
            background: "var(--color-accent, #2f6f8f)",
            color: "var(--color-paper, #fff)",
            cursor: busy || !source.trim() ? "not-allowed" : "pointer",
            opacity: busy || !source.trim() ? 0.5 : 1,
            fontFamily: "inherit",
          }}
        >
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
      {error && (
        <div style={{ fontSize: 11, color: "var(--color-error, #b91c1c)" }}>{error}</div>
      )}
    </div>
  );
}

const rowButtonStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "10px 12px",
  border: "none",
  borderRadius: 6,
  background: "transparent",
  cursor: "pointer",
  fontFamily: "inherit",
  marginBottom: 2,
};
