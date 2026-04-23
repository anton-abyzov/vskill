import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { strings } from "../strings";
import {
  lookupSetupProvider,
  type SetupProviderContent,
} from "./SetupDrawer.providers";

// ---------------------------------------------------------------------------
// 0686 T-010 + T-011 (US-005): SetupDrawer — 480px right-slide drawer that
// surfaces per-provider setup instructions (env vars, key URL, local
// install & run blocks, learn-more).
//
// - Portal-mounted so it floats above the Studio shell.
// - role="dialog" + aria-modal="true"; Esc closes; backdrop click closes.
// - Body content is driven by the SETUP_PROVIDER_CONTENT registry — no
//   per-provider React files, keeps the diff tight and testable.
// - External links all carry `target="_blank"` + `rel="noopener noreferrer"`
//   (AC-US5-07 security guard).
// ---------------------------------------------------------------------------

export interface SetupDrawerProps {
  open: boolean;
  providerKey: string | null;
  onClose: () => void;
}

export function SetupDrawer({ open, providerKey, onClose }: SetupDrawerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Move focus into the drawer when it mounts (AC-US5-01 focus-trap seed).
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const firstFocusable = dialog.querySelector<HTMLElement>(
      "button, a[href], [tabindex]:not([tabindex='-1']), input, textarea, select",
    );
    firstFocusable?.focus();
  }, [open]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const content = lookupSetupProvider(providerKey);
  const title = content?.name ?? strings.setupDrawer.fallbackTitle;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        data-testid="setup-drawer-backdrop"
        aria-hidden="true"
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          zIndex: 99,
          animation: "vskillDrawerBackdropIn 120ms ease",
        }}
      />
      <div
        data-testid="setup-drawer"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={strings.setupDrawer.title(title)}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "480px",
          maxWidth: "100vw",
          background: "var(--bg-surface, var(--surface-1))",
          borderLeft: "1px solid var(--border-default, var(--border-subtle))",
          boxShadow: "-8px 0 32px rgba(0,0,0,0.18)",
          display: "flex",
          flexDirection: "column",
          zIndex: 100,
          fontFamily: "var(--font-sans)",
          animation: "vskillDrawerIn 200ms cubic-bezier(0.2, 0, 0, 1)",
        }}
      >
        <DrawerHeader title={title} onClose={onClose} />
        <div
          data-testid="setup-drawer-body"
          style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}
        >
          {content ? <ProviderBody content={content} /> : <FallbackBody />}
        </div>
        <style>
          {`@keyframes vskillDrawerIn {
            from { transform: translateX(100%); }
            to { transform: translateX(0); }
          }
          @keyframes vskillDrawerBackdropIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }`}
        </style>
      </div>
    </>,
    document.body,
  );
}

function DrawerHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 20px",
        borderBottom: "1px solid var(--border-default, var(--border-subtle))",
      }}
    >
      <h2
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: 18,
          fontWeight: 500,
          margin: 0,
          color: "var(--text-primary)",
        }}
      >
        {strings.setupDrawer.title(title)}
      </h2>
      <button
        type="button"
        data-testid="setup-drawer-close"
        onClick={onClose}
        aria-label={strings.setupDrawer.close}
        style={{
          background: "transparent",
          border: "none",
          color: "var(--text-secondary)",
          cursor: "pointer",
          fontSize: 18,
          padding: 4,
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </header>
  );
}

function ProviderBody({ content }: { content: SetupProviderContent }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* "What this is" */}
      <p
        style={{
          fontSize: 14,
          lineHeight: 1.5,
          color: "var(--text-primary)",
          margin: 0,
        }}
      >
        {content.description}
      </p>

      {/* Optional notes (e.g., Claude Code's login hint + Max/Pro label) */}
      {content.notes && content.notes.length > 0 && (
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {content.notes.map((note) => (
            <li
              key={note}
              style={{
                fontSize: 13,
                color: "var(--text-secondary)",
                padding: "8px 10px",
                background:
                  "color-mix(in srgb, var(--accent-surface) 8%, transparent)",
                borderRadius: 4,
              }}
            >
              {note}
            </li>
          ))}
        </ul>
      )}

      {/* Required env vars */}
      {content.envVars.length > 0 && (
        <section>
          <h3
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-secondary)",
              margin: "0 0 8px",
            }}
          >
            {strings.setupDrawer.requiredEnv}
          </h3>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {content.envVars.map((env) => (
              <li key={env}>
                <EnvVarChip name={env} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Get-a-key CTA */}
      {content.keyUrl && (
        <ExternalLinkButton
          href={content.keyUrl}
          label={strings.setupDrawer.getKey}
          testId="setup-drawer-get-key"
        />
      )}

      {/* Install + run (local providers) */}
      {(content.install || content.start || content.pullExample) && (
        <section>
          <h3
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-secondary)",
              margin: "0 0 8px",
            }}
          >
            {strings.setupDrawer.installRun}
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {content.install?.map((line, i) => (
              <CodeBlock key={`install-${i}`} code={line} />
            ))}
            {content.start?.map((line, i) => (
              <CodeBlock key={`start-${i}`} code={line} />
            ))}
            {content.pullExample && <CodeBlock code={content.pullExample} />}
          </div>
        </section>
      )}

      {/* Learn more */}
      <footer style={{ marginTop: 8 }}>
        <a
          href={content.learnMoreUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="setup-drawer-learn-more"
          style={{
            fontSize: 12,
            color: "var(--color-accent, var(--accent-surface))",
            textDecoration: "none",
          }}
        >
          {strings.setupDrawer.learnMore} →
        </a>
      </footer>
    </div>
  );
}

function FallbackBody() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h3
        style={{
          margin: 0,
          fontFamily: "var(--font-serif)",
          fontSize: 16,
          fontWeight: 500,
          color: "var(--text-primary)",
        }}
      >
        {strings.setupDrawer.fallbackTitle}
      </h3>
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: "var(--text-secondary)",
          lineHeight: 1.5,
        }}
      >
        {strings.setupDrawer.fallbackBody}
      </p>
    </div>
  );
}

function EnvVarChip({ name }: { name: string }) {
  const onCopy = async () => {
    try {
      await navigator.clipboard?.writeText(name);
    } catch {
      /* user denied clipboard — silent */
    }
  };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px",
        background:
          "color-mix(in srgb, var(--border-default) 30%, transparent)",
        borderRadius: 4,
      }}
    >
      <code
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--text-primary)",
          flex: 1,
        }}
      >
        {name}
      </code>
      <button
        type="button"
        onClick={onCopy}
        aria-label={`Copy ${name} to clipboard`}
        style={{
          background: "transparent",
          border: "1px solid var(--border-default, var(--border-subtle))",
          borderRadius: 3,
          padding: "2px 8px",
          color: "var(--text-secondary)",
          fontSize: 11,
          fontFamily: "var(--font-sans)",
          cursor: "pointer",
        }}
      >
        {strings.setupDrawer.copy}
      </button>
    </div>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <pre
      style={{
        margin: 0,
        padding: "8px 10px",
        background: "var(--bg-canvas, #111)",
        color: "var(--text-primary)",
        fontFamily: "var(--font-mono)",
        fontSize: 11.5,
        lineHeight: 1.5,
        borderRadius: 4,
        border: "1px solid var(--border-default, var(--border-subtle))",
        overflowX: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {code}
    </pre>
  );
}

function ExternalLinkButton({
  href,
  label,
  testId,
}: {
  href: string;
  label: string;
  testId?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={testId}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "8px 14px",
        borderRadius: 6,
        border: "1px solid var(--border-default, var(--border-subtle))",
        background:
          "color-mix(in srgb, var(--accent-surface) 12%, transparent)",
        color: "var(--text-primary)",
        textDecoration: "none",
        fontSize: 13,
        fontWeight: 500,
        fontFamily: "var(--font-sans)",
        width: "fit-content",
      }}
    >
      {label} →
    </a>
  );
}
