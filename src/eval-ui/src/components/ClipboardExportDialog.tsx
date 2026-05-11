import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// ---------------------------------------------------------------------------
// 0845 T-020 — ClipboardExportDialog
//
// Renders a paste-ready blob for a single Tier 3 (cloud-only) agent target
// — ChatGPT Custom Instructions, v0, bolt.new. Always opens AFTER the
// install SSE stream has closed (AC-US5-08): in mixed-install scenarios,
// the InstallTargetsModal collects every Tier-3 result and opens one
// dialog per target sequentially.
//
// Critical contract (AC-US5-05): navigator.clipboard.writeText() runs
// ONLY on the user-gesture click handler — never from useEffect, never
// from an SSE callback. Browsers reject background clipboard writes.
// ---------------------------------------------------------------------------

export interface ClipboardExportDialogProps {
  agentId: string;
  agentDisplayName: string;
  blob: string;
  pasteInstructionsUrl?: string;
  docsUrl?: string;
  /**
   * Optional scope-downgrade warning surfaced from the server (US-005
   * AC-US5-06). Rendered as a yellow info banner under the title.
   */
  scopeDowngradeWarning?: string;
  onClose: () => void;
  /** Test-injectable override for navigator.clipboard.writeText. */
  writeClipboardImpl?: (text: string) => Promise<void>;
}

async function defaultWriteClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error("Clipboard API unavailable in this environment");
}

export function ClipboardExportDialog({
  agentId,
  agentDisplayName,
  blob,
  pasteInstructionsUrl,
  docsUrl,
  scopeDowngradeWarning,
  onClose,
  writeClipboardImpl,
}: ClipboardExportDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // AC-US5-05: write only on user gesture (click handler). Never auto-write.
  const handleCopy = useCallback(async () => {
    const writer = writeClipboardImpl ?? defaultWriteClipboard;
    try {
      await writer(blob);
      setCopied(true);
      setCopyError(null);
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : String(err));
    }
  }, [blob, writeClipboardImpl]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      data-testid="clipboard-export-dialog-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "min(10vh, 80px)",
        zIndex: 9999,
      }}
    >
      <div
        ref={dialogRef}
        data-testid="clipboard-export-dialog"
        data-agent-id={agentId}
        role="dialog"
        aria-modal="true"
        aria-label={`Copy skill to ${agentDisplayName}`}
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 640,
          margin: "0 1rem",
          background: "var(--bg-surface, #FFFFFF)",
          color: "var(--text-primary, #191919)",
          borderRadius: 8,
          border: "1px solid var(--color-rule, #E8E1D6)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
          overflow: "hidden",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "0.875rem 1.125rem",
            borderBottom: "1px solid var(--color-rule, #E8E1D6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-serif, serif)",
              fontSize: 16,
              fontWeight: 500,
            }}
          >
            Copy to {agentDisplayName}
          </div>
          <button
            type="button"
            data-testid="clipboard-export-dialog-close"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: 18,
              color: "var(--text-secondary, #5A5651)",
              padding: "0 4px",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            padding: "1rem 1.125rem",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
          }}
        >
          {scopeDowngradeWarning && (
            <div
              data-testid="clipboard-export-scope-warning"
              role="status"
              style={{
                padding: "0.625rem 0.875rem",
                background: "color-mix(in srgb, var(--color-own, #f59e0b) 14%, transparent)",
                border: "1px solid color-mix(in srgb, var(--color-own, #f59e0b) 45%, transparent)",
                borderRadius: 6,
                fontSize: 12,
                color: "var(--text-primary, #191919)",
              }}
            >
              {scopeDowngradeWarning}
            </div>
          )}

          <div
            style={{
              fontSize: 12,
              color: "var(--text-secondary, #5A5651)",
              lineHeight: 1.5,
            }}
          >
            Click <strong>Copy</strong> below, then paste the skill into{" "}
            {agentDisplayName}.
            {pasteInstructionsUrl ? (
              <>
                {" "}
                <a
                  data-testid="clipboard-export-paste-instructions-link"
                  href={pasteInstructionsUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  style={{
                    color: "var(--accent-text, var(--text-primary))",
                    textDecoration: "underline",
                  }}
                >
                  Open paste instructions →
                </a>
              </>
            ) : null}
          </div>

          <pre
            data-testid="clipboard-export-blob"
            style={{
              margin: 0,
              padding: "0.75rem",
              background: "var(--surface-2, #F6F4EE)",
              border: "1px solid var(--color-rule, #E8E1D6)",
              borderRadius: 6,
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 12,
              lineHeight: 1.5,
              overflowX: "auto",
              maxHeight: "40vh",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {blob}
          </pre>

          {copyError && (
            <div
              data-testid="clipboard-export-error"
              role="alert"
              style={{
                fontSize: 12,
                color: "var(--color-error, #dc2626)",
              }}
            >
              Copy failed: {copyError}
            </div>
          )}
        </div>

        <div
          style={{
            padding: "0.75rem 1.125rem",
            borderTop: "1px solid var(--color-rule, #E8E1D6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.75rem",
          }}
        >
          <div style={{ display: "flex", gap: "0.625rem" }}>
            {docsUrl && (
              <a
                data-testid="clipboard-export-docs-link"
                href={docsUrl}
                target="_blank"
                rel="noreferrer noopener"
                style={{
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  textDecoration: "underline",
                }}
              >
                {agentDisplayName} docs
              </a>
            )}
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              data-testid="clipboard-export-dialog-cancel"
              onClick={onClose}
              style={{
                padding: "0.5rem 0.875rem",
                borderRadius: 6,
                border: "1px solid var(--color-rule, #E8E1D6)",
                background: "transparent",
                color: "var(--text-primary)",
                cursor: "pointer",
                fontSize: 13,
                fontFamily: "var(--font-sans)",
              }}
            >
              Close
            </button>
            <button
              type="button"
              data-testid="clipboard-export-copy"
              onClick={handleCopy}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: 6,
                border: "1px solid var(--text-primary, #191919)",
                background: copied
                  ? "var(--color-ok, #22c55e)"
                  : "var(--text-primary, #191919)",
                color: "var(--bg-surface, #FFFFFF)",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "var(--font-sans)",
              }}
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
