// ---------------------------------------------------------------------------
// LockedProviderRow — inline CTA replacing grey-out for locked agents.
//
// Three variants:
//   - "api-key"       — "Add API key →"  → opens Settings modal on that tab
//   - "cli-install"   — "Install <Tool> →" → opens docs URL in a new tab
//   - "start-service" — "Start service →"   → opens help popover (not modal)
//
// All variants render at calm `var(--accent)` CTA text, no global opacity
// reduction, no `cursor: not-allowed`.
// ---------------------------------------------------------------------------

import type { KeyboardEvent, MouseEvent } from "react";

export type LockedCtaVariant = "api-key" | "cli-install" | "start-service";

export interface LockedProviderRowProps {
  variant: LockedCtaVariant;
  label: string;
  onActivate: () => void;
  installUrl?: string;
}

export function LockedProviderRow({ variant, label, onActivate, installUrl }: LockedProviderRowProps) {
  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    if (variant === "cli-install" && installUrl) {
      window.open(installUrl, "_blank", "noopener,noreferrer");
      return;
    }
    onActivate();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick(e as unknown as MouseEvent<HTMLButtonElement>);
    }
  }

  return (
    <button
      type="button"
      data-testid={`locked-cta-${variant}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className="inline-flex items-center gap-1.5 px-0 py-0 text-[11px] font-medium"
      style={{
        color: "var(--accent, var(--text-primary))",
        background: "transparent",
        border: "none",
        cursor: "pointer",
      }}
      aria-label={label}
    >
      {label}
    </button>
  );
}

export function LockIcon({ unlocked = false, size = 10 }: { unlocked?: boolean; size?: number }) {
  if (unlocked) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="7" width="10" height="7" rx="1" />
        <path d="M5 7V4.5A3 3 0 0 1 11 3.5" />
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="7" width="10" height="7" rx="1" />
      <path d="M5 7V4.5A3 3 0 0 1 11 4.5V7" />
    </svg>
  );
}
