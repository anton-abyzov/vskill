// ---------------------------------------------------------------------------
// ProvidersSegment — glanceable per-provider lock/unlock glyphs in StatusBar.
//
// Fixed order: Claude Code → Anthropic API → OpenRouter → Ollama → LM Studio.
// Below 640px viewport, collapses to a single "N/M providers" summary with a
// popover showing the full list.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { LockIcon } from "./LockedProviderRow";
import { strings } from "../strings";

export type ProvidersSegmentKind = "api-key" | "cli-install" | "start-service";

export interface ProvidersSegmentProvider {
  id: string;
  label: string;
  available: boolean;
  kind: ProvidersSegmentKind;
}

interface Props {
  providers: ProvidersSegmentProvider[];
  onOpenSettings?: (providerId: string) => void;
  onOpenInstallHelp?: (providerId: string) => void;
}

const DISPLAY_ORDER = ["claude-cli", "anthropic", "openrouter", "ollama", "lm-studio"];

function sortByOrder(providers: ProvidersSegmentProvider[]): ProvidersSegmentProvider[] {
  const byId = new Map(providers.map((p) => [p.id, p]));
  const ordered: ProvidersSegmentProvider[] = [];
  for (const id of DISPLAY_ORDER) {
    const p = byId.get(id);
    if (p) ordered.push(p);
  }
  // Append any unknown ids.
  for (const p of providers) {
    if (!DISPLAY_ORDER.includes(p.id)) ordered.push(p);
  }
  return ordered;
}

function useIsNarrow(threshold: number): boolean {
  const [narrow, setNarrow] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(`(max-width: ${threshold}px)`).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(`(max-width: ${threshold}px)`);
    const handler = () => setNarrow(mq.matches);
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, [threshold]);
  return narrow;
}

export function ProvidersSegment({ providers, onOpenSettings, onOpenInstallHelp }: Props) {
  const ordered = sortByOrder(providers);
  const narrow = useIsNarrow(640);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const handleClick = useCallback(
    (p: ProvidersSegmentProvider) => {
      if (p.available || p.kind === "api-key") {
        onOpenSettings?.(p.id);
      } else {
        onOpenInstallHelp?.(p.id);
      }
    },
    [onOpenSettings, onOpenInstallHelp],
  );

  if (narrow) {
    const count = ordered.filter((p) => p.available).length;
    return (
      <div
        data-testid="providers-segment"
        style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
      >
        <button
          type="button"
          data-testid="providers-summary"
          onClick={() => setPopoverOpen(!popoverOpen)}
          aria-label={strings.statusBar.providerSummary(count, ordered.length)}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--text-secondary)",
            fontSize: 11,
            cursor: "pointer",
            padding: "0 4px",
          }}
        >
          {strings.statusBar.providerSummary(count, ordered.length)}
        </button>
        {popoverOpen && (
          <div
            role="menu"
            style={{
              position: "absolute",
              bottom: "120%",
              right: 0,
              background: "var(--bg-surface, var(--surface-1))",
              border: "1px solid var(--border-default, var(--border-subtle))",
              borderRadius: 6,
              padding: 6,
              minWidth: 180,
              display: "flex",
              flexDirection: "column",
              gap: 2,
              zIndex: 80,
            }}
          >
            {ordered.map((p) => (
              <ProviderButton key={p.id} p={p} onClick={handleClick} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="providers-segment"
      style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
    >
      {ordered.map((p) => (
        <ProviderButton key={p.id} p={p} onClick={handleClick} compact />
      ))}
    </div>
  );
}

function ProviderButton({
  p,
  onClick,
  compact,
}: {
  p: ProvidersSegmentProvider;
  onClick: (p: ProvidersSegmentProvider) => void;
  compact?: boolean;
}) {
  const ariaLabel = p.available
    ? strings.statusBar.unlocked(p.label)
    : p.kind === "cli-install"
      ? strings.statusBar.lockedCli(p.label)
      : strings.statusBar.locked(p.label);

  return (
    <button
      type="button"
      data-testid={`provider-glyph-${p.id}`}
      data-available={p.available}
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={() => onClick(p)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: "transparent",
        border: "none",
        color: p.available ? "var(--status-installed)" : "var(--text-muted, var(--text-tertiary))",
        cursor: "pointer",
        padding: compact ? "2px" : "4px 6px",
        fontSize: 11,
      }}
    >
      <LockIcon unlocked={p.available} size={10} />
      {!compact && <span>{p.label}</span>}
    </button>
  );
}
