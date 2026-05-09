// 0834 T-025 — TokensTable.
//
// Rendering-pure list of API tokens + an inline "Generate new token"
// modal + a revoke confirmation modal. Plaintext is shown ONCE after
// generation in a copy-to-clipboard panel; the host should clear the
// `recentlyCreated` prop as soon as the user dismisses the panel so it
// never persists across remounts.
//
// AC-US8-03, AC-US8-05, AC-US8-06.

import { useState } from "react";
import type {
  TokenCreateRequestDTO,
  TokenCreateResponseDTO,
  TokenDTO,
  TokenScope,
} from "../../types/account";

const EXPIRY_OPTIONS = [
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 365, label: "1 year" },
  { value: 0, label: "Never" },
] as const;

export interface TokensTableProps {
  tokens: ReadonlyArray<TokenDTO>;
  /** Wire response from the most recent POST /tokens — shown ONCE. */
  recentlyCreated?: TokenCreateResponseDTO | null;
  /** Called when the host should clear `recentlyCreated` (modal dismissed). */
  onDismissRecentlyCreated?: () => void;
  onCreate(input: TokenCreateRequestDTO): Promise<void> | void;
  onRevoke(token: TokenDTO): Promise<void> | void;
  /** Per-token spinner overlay. */
  pendingRevokeId?: string | null;
  /** When true, Generate button is disabled (network in flight). */
  creating?: boolean;
  /** "Now" override for deterministic relative-time tests. */
  now?: Date;
}

export function TokensTable({
  tokens,
  recentlyCreated,
  onDismissRecentlyCreated,
  onCreate,
  onRevoke,
  pendingRevokeId,
  creating = false,
  now = new Date(),
}: TokensTableProps) {
  const [generateOpen, setGenerateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<TokenDTO | null>(null);

  return (
    <div data-testid="tokens-table-root">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            API tokens
          </h2>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 12,
              color: "var(--text-secondary)",
            }}
          >
            Use these to authenticate the CLI or scripted integrations.
          </p>
        </div>
        <button
          type="button"
          data-testid="tokens-generate-button"
          onClick={() => setGenerateOpen(true)}
          disabled={creating}
          style={{
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 500,
            fontFamily: "inherit",
            background: "var(--color-accent, #2563eb)",
            color: "#fff",
            border: "1px solid var(--color-accent, #2563eb)",
            borderRadius: 6,
            cursor: creating ? "not-allowed" : "pointer",
            opacity: creating ? 0.6 : 1,
          }}
        >
          Generate new token
        </button>
      </div>

      {tokens.length === 0 ? (
        <EmptyState onGenerateClick={() => setGenerateOpen(true)} />
      ) : (
        <table
          data-testid="tokens-table"
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: "var(--font-sans)",
            fontSize: 13,
          }}
        >
          <thead>
            <tr
              style={{
                borderBottom: "1px solid var(--border-default, #e5e7eb)",
              }}
            >
              <Th>Name</Th>
              <Th>Prefix</Th>
              <Th>Scopes</Th>
              <Th>Last used</Th>
              <Th>Created</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr
                key={t.id}
                data-testid={`token-row-${t.id}`}
                style={{
                  borderBottom: "1px solid var(--border-default, #e5e7eb)",
                  opacity: t.revokedAt ? 0.55 : 1,
                }}
              >
                <Td>{t.name}</Td>
                <Td>
                  <code
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                      color: "var(--text-secondary)",
                    }}
                  >
                    {t.prefix}…
                  </code>
                </Td>
                <Td>{t.scopes.join(", ")}</Td>
                <Td>{relativeOrDash(t.lastUsedAt, now)}</Td>
                <Td>{relativeOrDash(t.createdAt, now)}</Td>
                <Td align="right">
                  {t.revokedAt ? (
                    <span style={{ color: "var(--text-tertiary)" }}>Revoked</span>
                  ) : (
                    <button
                      type="button"
                      data-testid={`token-revoke-${t.id}`}
                      disabled={pendingRevokeId === t.id}
                      onClick={() => setRevokeTarget(t)}
                      style={{
                        padding: "4px 10px",
                        fontSize: 12,
                        fontFamily: "inherit",
                        background: "transparent",
                        border: "1px solid var(--border-default, #e5e7eb)",
                        borderRadius: 4,
                        color: "#dc2626",
                        cursor:
                          pendingRevokeId === t.id ? "not-allowed" : "pointer",
                      }}
                    >
                      {pendingRevokeId === t.id ? "Revoking…" : "Revoke"}
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {generateOpen && (
        <GenerateModal
          creating={creating}
          onCancel={() => setGenerateOpen(false)}
          onSubmit={async (values) => {
            await onCreate(values);
            setGenerateOpen(false);
          }}
        />
      )}

      {recentlyCreated && (
        <CreatedTokenModal
          created={recentlyCreated}
          onDismiss={() => onDismissRecentlyCreated?.()}
        />
      )}

      {revokeTarget && (
        <RevokeModal
          token={revokeTarget}
          pending={pendingRevokeId === revokeTarget.id}
          onCancel={() => setRevokeTarget(null)}
          onConfirm={async () => {
            await onRevoke(revokeTarget);
            setRevokeTarget(null);
          }}
        />
      )}
    </div>
  );
}

function EmptyState({ onGenerateClick }: { onGenerateClick: () => void }) {
  return (
    <div
      data-testid="tokens-empty-state"
      style={{
        textAlign: "center",
        padding: "40px 20px",
        background: "var(--bg-canvas, #f9fafb)",
        border: "1px dashed var(--border-default, #e5e7eb)",
        borderRadius: 8,
        fontFamily: "var(--font-sans)",
      }}
    >
      <div style={{ fontSize: 14, color: "var(--text-primary)", marginBottom: 6 }}>
        No tokens yet — generate one to use the CLI.
      </div>
      <button
        type="button"
        onClick={onGenerateClick}
        style={{
          padding: "6px 14px",
          fontSize: 13,
          fontFamily: "inherit",
          background: "var(--color-accent, #2563eb)",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        Generate new token
      </button>
    </div>
  );
}

function GenerateModal({
  creating,
  onCancel,
  onSubmit,
}: {
  creating: boolean;
  onCancel: () => void;
  onSubmit(input: TokenCreateRequestDTO): Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [readScope, setReadScope] = useState(true);
  const [writeScope, setWriteScope] = useState(false);
  const [expiry, setExpiry] = useState<number>(90);
  const valid = name.trim().length > 0 && (readScope || writeScope);

  return (
    <ModalShell
      title="Generate new token"
      onDismiss={onCancel}
      testId="tokens-generate-modal"
    >
      <Field label="Name" htmlFor="token-name">
        <input
          id="token-name"
          data-testid="token-name-input"
          type="text"
          value={name}
          maxLength={64}
          disabled={creating}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Build CI"
          style={inputStyle}
        />
      </Field>

      <Field label="Scopes">
        <div style={{ display: "flex", gap: 16 }}>
          <Checkbox
            label="read"
            checked={readScope}
            disabled={creating}
            onChange={setReadScope}
            testId="scope-read"
          />
          <Checkbox
            label="write"
            checked={writeScope}
            disabled={creating}
            onChange={setWriteScope}
            testId="scope-write"
          />
        </div>
      </Field>

      <Field label="Expiry">
        <select
          data-testid="token-expiry-select"
          value={expiry}
          disabled={creating}
          onChange={(e) => setExpiry(Number(e.target.value))}
          style={inputStyle}
        >
          {EXPIRY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      <ModalActions>
        <SecondaryButton onClick={onCancel} disabled={creating}>
          Cancel
        </SecondaryButton>
        <PrimaryButton
          disabled={!valid || creating}
          onClick={() => {
            const scopes: TokenScope[] = [];
            if (readScope) scopes.push("read");
            if (writeScope) scopes.push("write");
            void onSubmit({
              name: name.trim(),
              scopes,
              expiresInDays: expiry,
            });
          }}
        >
          {creating ? "Generating…" : "Generate"}
        </PrimaryButton>
      </ModalActions>
    </ModalShell>
  );
}

function CreatedTokenModal({
  created,
  onDismiss,
}: {
  created: TokenCreateResponseDTO;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(created.plaintext);
      setCopied(true);
    } catch {
      // Clipboard access denied — fall through; the user can select-copy
      // manually from the visible monospace block.
    }
  }

  return (
    <ModalShell
      title="Token created"
      onDismiss={onDismiss}
      testId="tokens-created-modal"
    >
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: "var(--text-primary)",
          background: "rgba(245, 158, 11, 0.12)",
          border: "1px solid rgba(245, 158, 11, 0.4)",
          padding: 12,
          borderRadius: 6,
        }}
      >
        <strong>This is the only time you'll see this token.</strong> Store it
        somewhere safe — verified-skill never stores the plaintext.
      </p>

      <div
        data-testid="tokens-plaintext"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          padding: 12,
          background: "var(--bg-canvas, #f3f4f6)",
          border: "1px solid var(--border-default, #e5e7eb)",
          borderRadius: 6,
          wordBreak: "break-all",
          userSelect: "all",
        }}
      >
        {created.plaintext}
      </div>

      <ModalActions>
        <SecondaryButton onClick={handleCopy}>
          {copied ? "Copied!" : "Copy to clipboard"}
        </SecondaryButton>
        <PrimaryButton onClick={onDismiss}>Done</PrimaryButton>
      </ModalActions>
    </ModalShell>
  );
}

function RevokeModal({
  token,
  pending,
  onCancel,
  onConfirm,
}: {
  token: TokenDTO;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}) {
  return (
    <ModalShell
      title={`Revoke ${token.prefix}…?`}
      onDismiss={onCancel}
      testId="tokens-revoke-modal"
    >
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: "var(--text-primary)",
        }}
      >
        Any process using this token will fail immediately. This cannot be
        undone.
      </p>
      <ModalActions>
        <SecondaryButton onClick={onCancel} disabled={pending}>
          Cancel
        </SecondaryButton>
        <DangerButton disabled={pending} onClick={() => void onConfirm()}>
          {pending ? "Revoking…" : "Revoke"}
        </DangerButton>
      </ModalActions>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Local primitives — kept inline to avoid pulling a design-system dep into
// eval-ui v1. T-026+ may extract these into shared/ if reuse pays off.
// ---------------------------------------------------------------------------

function ModalShell({
  title,
  testId,
  onDismiss,
  children,
}: {
  title: string;
  testId: string;
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid={testId}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        fontFamily: "var(--font-sans)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div
        style={{
          width: "min(440px, calc(100vw - 32px))",
          background: "var(--bg-elevated, #fff)",
          borderRadius: 10,
          border: "1px solid var(--border-default, #e5e7eb)",
          boxShadow: "0 18px 40px rgba(0,0,0,0.18)",
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 600,
            color: "var(--text-primary)",
          }}
        >
          {title}
        </h3>
        {children}
      </div>
    </div>
  );
}

function ModalActions({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        justifyContent: "flex-end",
        marginTop: 4,
      }}
    >
      {children}
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "8px 16px",
        fontSize: 13,
        fontFamily: "inherit",
        background: disabled
          ? "var(--bg-canvas, #f3f4f6)"
          : "var(--color-accent, #2563eb)",
        color: disabled ? "var(--text-tertiary)" : "#fff",
        border: `1px solid ${
          disabled ? "var(--border-default, #e5e7eb)" : "var(--color-accent, #2563eb)"
        }`,
        borderRadius: 6,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "8px 16px",
        fontSize: 13,
        fontFamily: "inherit",
        background: "transparent",
        color: "var(--text-primary)",
        border: "1px solid var(--border-default, #e5e7eb)",
        borderRadius: 6,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  );
}

function DangerButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "8px 16px",
        fontSize: 13,
        fontFamily: "inherit",
        background: disabled ? "var(--bg-canvas, #f3f4f6)" : "#dc2626",
        color: disabled ? "var(--text-tertiary)" : "#fff",
        border: "1px solid #dc2626",
        borderRadius: 6,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label
        htmlFor={htmlFor}
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: "var(--text-primary)",
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function Checkbox({
  label,
  checked,
  onChange,
  disabled,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 13,
        cursor: disabled ? "not-allowed" : "pointer",
        color: "var(--text-primary)",
      }}
    >
      <input
        type="checkbox"
        data-testid={testId}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      style={{
        textAlign: align,
        padding: "10px 12px",
        fontWeight: 600,
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: "var(--text-secondary)",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      style={{
        textAlign: align,
        padding: "12px 12px",
        verticalAlign: "middle",
      }}
    >
      {children}
    </td>
  );
}

function relativeOrDash(iso: string | null, now: Date): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMs = now.getTime() - then;
  if (diffMs < 60_000) return "Just now";
  const min = Math.floor(diffMs / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 13,
  fontFamily: "inherit",
  color: "var(--text-primary)",
  background: "var(--bg-elevated, #fff)",
  border: "1px solid var(--border-default, #e5e7eb)",
  borderRadius: 6,
  boxSizing: "border-box",
};
