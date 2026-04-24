// ---------------------------------------------------------------------------
// SettingsModal — unified surface for API keys.
//
// Reachable from AgentModelPicker footer or via Cmd+, . Focus-trapped,
// ARIA-compliant, motion-bypassed under prefers-reduced-motion.
//
// 0702: Storage-mode selection removed. Keys live in a single file at
// `~/.vskill/keys.env` (server resolves the absolute path via
// `GET /api/settings/storage-path`). Three providers: anthropic, openai,
// openrouter (ids sourced from the list-keys response shape).
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { useCredentialStorage, type CredentialProvider } from "../hooks/useCredentialStorage";
import { strings } from "../strings";
import { MigrationBanner } from "./MigrationBanner";

export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  initialProvider?: CredentialProvider;
  onToast?: (message: string) => void;
}

interface ProviderMeta {
  id: CredentialProvider;
  name: string;
  keyIssuanceUrl: string;
  prefix: string;
  placeholder: string;
}

const PROVIDERS: ProviderMeta[] = [
  {
    id: "anthropic",
    name: strings.providers.anthropic.name,
    keyIssuanceUrl: strings.providers.anthropic.keyIssuanceUrl,
    prefix: strings.providers.anthropic.keyPrefix,
    placeholder: `Paste ${strings.providers.anthropic.name} key`,
  },
  {
    id: "openai",
    name: strings.providers.openai.name,
    keyIssuanceUrl: strings.providers.openai.keyIssuanceUrl,
    prefix: strings.providers.openai.keyPrefix,
    placeholder: strings.providers.openai.pastePlaceholder,
  },
  {
    id: "openrouter",
    name: strings.providers.openrouter.name,
    keyIssuanceUrl: strings.providers.openrouter.keyIssuanceUrl,
    prefix: strings.providers.openrouter.keyPrefix,
    placeholder: `Paste ${strings.providers.openrouter.name} key`,
  },
];

function formatRelative(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return new Date(iso).toLocaleString();
}

export function SettingsModal({ open, onClose, initialProvider, onToast }: SettingsModalProps) {
  const { state, save, remove, refresh } = useCredentialStorage();
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const [storagePath, setStoragePath] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch("/api/settings/storage-path");
        if (!resp.ok) throw new Error(`GET /api/settings/storage-path returned ${resp.status}`);
        const data = (await resp.json()) as { path: string };
        if (!cancelled) setStoragePath(data.path ?? null);
      } catch {
        if (!cancelled) setStoragePath(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const selector = initialProvider
        ? `input[data-provider="${initialProvider}"]`
        : "input[data-provider]";
      const target = dialogRef.current?.querySelector<HTMLInputElement>(selector);
      target?.focus();
    }, 0);
    return () => {
      clearTimeout(t);
      previouslyFocused?.focus?.();
    };
  }, [open, initialProvider]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  const copyPath = useCallback(async () => {
    if (!storagePath) return;
    try {
      await navigator.clipboard?.writeText?.(storagePath);
      onToast?.(strings.settings.pathCopied);
    } catch {
      // Clipboard denied — no-op.
    }
  }, [onToast, storagePath]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      data-testid="settings-modal"
      style={{
        position: "fixed",
        inset: 0,
        background: "color-mix(in srgb, black 40%, transparent)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        style={{
          background: "var(--bg-surface, var(--surface-1))",
          border: "1px solid var(--border-default, var(--border-subtle))",
          borderRadius: 8,
          width: 560,
          maxHeight: "80vh",
          overflowY: "auto",
          padding: 20,
          fontFamily: "'Inter Tight Variable', 'Inter Tight', system-ui, sans-serif",
          color: "var(--text-primary)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="settings-modal-title"
          style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 600 }}
        >
          {strings.settings.title}
        </h2>

        <MigrationBanner onMigrated={() => { void refresh(); }} />

        <div
          role="note"
          data-testid="settings-banner"
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            background: "color-mix(in srgb, var(--info, var(--accent-muted)) 20%, transparent)",
            color: "var(--text-primary)",
            fontSize: 12,
            marginBottom: 16,
          }}
        >
          {strings.settings.banner}
        </div>

        <section aria-labelledby="settings-api-keys-title" style={{ marginBottom: 20 }}>
          <h3 id="settings-api-keys-title" style={{ fontSize: 13, fontWeight: 600, margin: "0 0 12px 0" }}>
            {strings.settings.sectionApiKeys}
          </h3>
          {PROVIDERS.map((p) => (
            <ProviderKeyRow
              key={p.id}
              providerId={p.id}
              providerName={p.name}
              keyIssuanceUrl={p.keyIssuanceUrl}
              prefix={p.prefix}
              placeholder={p.placeholder}
              metadata={state?.[p.id]}
              onSave={async (key) => {
                const res = await save(p.id, key);
                onToast?.(strings.settings.keySaved(p.name));
                return res;
              }}
              onRemove={async () => {
                await remove(p.id);
                onToast?.(strings.settings.keyRemoved(p.name));
              }}
              inputRef={p.id === (initialProvider ?? "anthropic") ? firstInputRef : undefined}
            />
          ))}
        </section>

        <div
          data-testid="settings-storage-path"
          style={{
            fontSize: 11,
            color: "var(--text-muted, var(--text-tertiary))",
            fontStyle: "italic",
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <span style={{ flex: 1 }}>
            {storagePath ? strings.settings.storagePath(storagePath) : strings.settings.storagePathFallback}
          </span>
          <button
            type="button"
            onClick={copyPath}
            disabled={!storagePath}
            data-testid="settings-copy-path"
            style={{
              ...buttonStyle,
              opacity: storagePath ? 1 : 0.5,
              cursor: storagePath ? "pointer" : "not-allowed",
            }}
          >
            {strings.settings.copyPath}
          </button>
        </div>

        <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "6px 12px",
              background: "var(--surface-2, transparent)",
              border: "1px solid var(--border-default, var(--border-subtle))",
              borderRadius: 6,
              color: "var(--text-primary)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

interface ProviderKeyRowProps {
  providerId: CredentialProvider;
  providerName: string;
  keyIssuanceUrl: string;
  prefix: string;
  placeholder: string;
  metadata: { stored: boolean; updatedAt: string | null } | undefined;
  onSave: (key: string) => Promise<{ ok: boolean; warning?: string }>;
  onRemove: () => Promise<void>;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

function ProviderKeyRow({
  providerId,
  providerName,
  keyIssuanceUrl,
  prefix,
  placeholder,
  metadata,
  onSave,
  onRemove,
  inputRef,
}: ProviderKeyRowProps) {
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const trimmed = value.trim();
  const emptyGuard = trimmed.length === 0;
  const prefixLooksWrong = trimmed.length > 0 && !trimmed.startsWith(prefix);

  const save = useCallback(async () => {
    if (emptyGuard) return;
    setSaving(true);
    const toSend = trimmed;
    // Clear input immediately — shrink plaintext dwell time in component state.
    setValue("");
    try {
      const res = await onSave(toSend);
      if (res.warning) setWarning(res.warning);
      else setWarning(null);
    } finally {
      setSaving(false);
    }
  }, [emptyGuard, onSave, trimmed]);

  const paste = useCallback(async () => {
    try {
      if (!navigator.clipboard?.readText) return;
      const text = await navigator.clipboard.readText();
      setValue(text);
    } catch {
      // User must manually paste — no-op
    }
  }, []);

  const remove = useCallback(async () => {
    setConfirm(false);
    await onRemove();
  }, [onRemove]);

  return (
    <div
      data-testid={`provider-row-${providerId}`}
      style={{
        padding: 12,
        border: "1px solid var(--border-subtle)",
        borderRadius: 6,
        marginBottom: 8,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <strong style={{ fontSize: 13 }}>{providerName}</strong>
        <a
          href={keyIssuanceUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 12, color: "var(--accent, var(--color-accent))" }}
        >
          Get a key →
        </a>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          ref={inputRef}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setWarning(null);
          }}
          data-provider={providerId}
          placeholder={placeholder}
          style={{
            flex: 1,
            padding: "6px 8px",
            border: "1px solid var(--border-subtle)",
            borderRadius: 4,
            background: "var(--surface-2, var(--bg-surface))",
            color: "var(--text-primary)",
            fontSize: 12,
            fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', monospace",
          }}
        />
        <button type="button" onClick={() => setShow(!show)} style={buttonStyle}>
          {show ? strings.settings.hide : strings.settings.show}
        </button>
        <button type="button" onClick={paste} style={buttonStyle}>
          {strings.settings.paste}
        </button>
      </div>
      {prefixLooksWrong && (
        <div role="status" data-testid={`prefix-warn-${providerId}`} style={warnStyle}>
          {strings.settings.prefixWarn(providerName)}
        </div>
      )}
      {warning && (
        <div role="status" style={warnStyle}>
          {warning}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button
          type="button"
          onClick={save}
          disabled={emptyGuard || saving}
          data-testid={`save-${providerId}`}
          style={{
            ...buttonStyle,
            background: emptyGuard ? "var(--surface-2)" : "var(--accent, var(--color-accent))",
            color: emptyGuard ? "var(--text-muted)" : "white",
            cursor: emptyGuard ? "not-allowed" : "pointer",
          }}
        >
          {strings.settings.save}
        </button>
        {metadata?.stored && (
          <>
            {!confirm ? (
              <button
                type="button"
                onClick={() => setConfirm(true)}
                data-testid={`remove-${providerId}`}
                style={{ ...buttonStyle, color: "var(--text-muted)" }}
              >
                {strings.settings.remove}
              </button>
            ) : (
              <>
                <span style={{ fontSize: 12 }}>{strings.settings.removeConfirm(providerName)}</span>
                <button
                  type="button"
                  onClick={remove}
                  data-testid={`remove-confirm-${providerId}`}
                  style={{ ...buttonStyle, background: "var(--danger, #b33)", color: "white" }}
                >
                  Confirm
                </button>
                <button type="button" onClick={() => setConfirm(false)} style={buttonStyle}>
                  Cancel
                </button>
              </>
            )}
          </>
        )}
        <span
          style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-muted, var(--text-tertiary))" }}
          data-testid={`status-${providerId}`}
        >
          {metadata?.stored && metadata.updatedAt
            ? strings.settings.keyStoredAt(formatRelative(metadata.updatedAt))
            : strings.settings.noKey}
        </span>
      </div>
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  padding: "4px 8px",
  background: "var(--surface-2, transparent)",
  border: "1px solid var(--border-subtle)",
  borderRadius: 4,
  color: "var(--text-primary)",
  fontSize: 12,
  cursor: "pointer",
};

const warnStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--warning, var(--text-muted))",
};
