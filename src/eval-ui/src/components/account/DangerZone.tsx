// 0834 T-025 — DangerZone.
//
// Three GitHub-style red-bordered cards: sign-out-all, export, and
// delete-account. Delete requires the user to type their GitHub handle
// to enable the confirm button (typo-protection).
//
// AC-US11-01.

import { useState } from "react";
import type { AccountExportDTO } from "../../types/account";

export interface DangerZoneProps {
  /** GitHub handle — used as the typed-confirmation phrase for delete. */
  githubHandle: string;
  /** Past export jobs (most-recent first). */
  exports?: ReadonlyArray<AccountExportDTO>;

  onSignOutAll(): Promise<void> | void;
  onExportRequest(): Promise<void> | void;
  onDeleteAccount(): Promise<void> | void;

  pending?: {
    signOutAll?: boolean;
    exportRequest?: boolean;
    deleteAccount?: boolean;
  };
  errorMessage?: string | null;
}

export function DangerZone({
  githubHandle,
  exports = [],
  onSignOutAll,
  onExportRequest,
  onDeleteAccount,
  pending,
  errorMessage = null,
}: DangerZoneProps) {
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <div
      data-testid="danger-zone"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        fontFamily: "var(--font-sans)",
      }}
    >
      <DangerCard
        title="Sign out of all devices"
        description="Revoke every active session and API token. You'll need to sign back in everywhere."
        actionLabel={pending?.signOutAll ? "Signing out…" : "Sign out everywhere"}
        actionDisabled={pending?.signOutAll}
        onClick={() => setSignOutOpen(true)}
      />

      <DangerCard
        title="Export my data"
        description="Queue an export of your skills, profile, and connected-repo metadata. Download link emailed within 24 hours."
        actionLabel={pending?.exportRequest ? "Queuing…" : "Export my data"}
        actionDisabled={pending?.exportRequest}
        onClick={() => void onExportRequest()}
      >
        <ExportsTable exports={exports} />
      </DangerCard>

      <DangerCard
        title="Delete account"
        description="Soft-delete your account. We retain your data for 30 days, then purge permanently. Connected repos are disconnected; tokens revoked."
        actionLabel="Delete account…"
        actionDisabled={pending?.deleteAccount}
        destructive
        onClick={() => setDeleteOpen(true)}
      />

      {errorMessage && (
        <div
          role="alert"
          data-testid="danger-zone-error"
          style={{
            padding: "8px 12px",
            background: "rgba(220, 38, 38, 0.08)",
            border: "1px solid rgba(220, 38, 38, 0.4)",
            color: "#991b1b",
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          {errorMessage}
        </div>
      )}

      {signOutOpen && (
        <SignOutAllModal
          pending={Boolean(pending?.signOutAll)}
          onCancel={() => setSignOutOpen(false)}
          onConfirm={async () => {
            await onSignOutAll();
            setSignOutOpen(false);
          }}
        />
      )}

      {deleteOpen && (
        <DeleteAccountModal
          githubHandle={githubHandle}
          pending={Boolean(pending?.deleteAccount)}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={async () => {
            await onDeleteAccount();
            setDeleteOpen(false);
          }}
        />
      )}
    </div>
  );
}

function DangerCard({
  title,
  description,
  actionLabel,
  actionDisabled,
  destructive,
  onClick,
  children,
}: {
  title: string;
  description: string;
  actionLabel: string;
  actionDisabled?: boolean;
  destructive?: boolean;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <section
      data-testid={`danger-card-${title.toLowerCase().replace(/\s+/g, "-")}`}
      style={{
        padding: 16,
        border: "1px solid rgba(220, 38, 38, 0.4)",
        borderRadius: 8,
        background: "rgba(220, 38, 38, 0.04)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div style={{ flex: 1 }}>
          <h3
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            {title}
          </h3>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 12,
              color: "var(--text-secondary)",
              lineHeight: 1.5,
            }}
          >
            {description}
          </p>
        </div>
        <button
          type="button"
          onClick={onClick}
          disabled={actionDisabled}
          style={{
            padding: "6px 14px",
            fontSize: 13,
            fontFamily: "inherit",
            background: destructive ? "#dc2626" : "transparent",
            color: destructive ? "#fff" : "#dc2626",
            border: "1px solid #dc2626",
            borderRadius: 6,
            cursor: actionDisabled ? "not-allowed" : "pointer",
            opacity: actionDisabled ? 0.6 : 1,
            whiteSpace: "nowrap",
          }}
        >
          {actionLabel}
        </button>
      </div>
      {children}
    </section>
  );
}

function ExportsTable({
  exports,
}: {
  exports: ReadonlyArray<AccountExportDTO>;
}) {
  if (exports.length === 0) {
    return (
      <div
        style={{
          marginTop: 12,
          padding: 10,
          fontSize: 12,
          color: "var(--text-tertiary)",
          background: "var(--bg-elevated, #fff)",
          border: "1px dashed var(--border-default, #e5e7eb)",
          borderRadius: 6,
        }}
      >
        No export jobs yet.
      </div>
    );
  }
  return (
    <table
      data-testid="exports-table"
      style={{
        marginTop: 12,
        width: "100%",
        borderCollapse: "collapse",
        fontSize: 12,
      }}
    >
      <thead>
        <tr
          style={{
            borderBottom: "1px solid var(--border-default, #e5e7eb)",
          }}
        >
          <th style={cellHead}>Requested</th>
          <th style={cellHead}>Status</th>
          <th style={cellHead}>Download</th>
        </tr>
      </thead>
      <tbody>
        {exports.map((e) => (
          <tr
            key={e.id}
            style={{
              borderBottom: "1px solid var(--border-default, #e5e7eb)",
            }}
          >
            <td style={cellBody}>{new Date(e.requestedAt).toLocaleString()}</td>
            <td style={cellBody}>{e.status}</td>
            <td style={cellBody}>
              {e.status === "ready" && e.downloadUrl ? (
                <a
                  href={e.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--color-accent, #2563eb)" }}
                >
                  Download
                </a>
              ) : (
                <span style={{ color: "var(--text-tertiary)" }}>—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SignOutAllModal({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}) {
  return (
    <ModalShell
      title="Sign out of all devices?"
      onDismiss={onCancel}
      testId="sign-out-all-modal"
    >
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: "var(--text-primary)",
        }}
      >
        Every active session and API token will be revoked. You'll need to
        sign back in on every device. This cannot be undone.
      </p>
      <ModalActions>
        <SecondaryButton onClick={onCancel} disabled={pending}>
          Cancel
        </SecondaryButton>
        <DangerButton disabled={pending} onClick={() => void onConfirm()}>
          {pending ? "Signing out…" : "Sign out everywhere"}
        </DangerButton>
      </ModalActions>
    </ModalShell>
  );
}

function DeleteAccountModal({
  githubHandle,
  pending,
  onCancel,
  onConfirm,
}: {
  githubHandle: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}) {
  const [typed, setTyped] = useState("");
  const matches = typed.trim() === githubHandle;

  return (
    <ModalShell
      title="Delete your account?"
      onDismiss={onCancel}
      testId="delete-account-modal"
    >
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: "var(--text-primary)",
          lineHeight: 1.5,
        }}
      >
        Your account will be soft-deleted for 30 days, then purged
        permanently. Connected repos are disconnected, API tokens revoked,
        and skills you've published become orphaned.
      </p>
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: "var(--text-primary)",
        }}
      >
        Type <strong>{githubHandle}</strong> to confirm:
      </p>
      <input
        type="text"
        data-testid="delete-account-confirm-input"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        autoFocus
        placeholder={githubHandle}
        disabled={pending}
        style={{
          width: "100%",
          padding: "8px 10px",
          fontSize: 13,
          fontFamily: "var(--font-mono)",
          color: "var(--text-primary)",
          background: "var(--bg-elevated, #fff)",
          border: "1px solid var(--border-default, #e5e7eb)",
          borderRadius: 6,
          boxSizing: "border-box",
        }}
      />
      <ModalActions>
        <SecondaryButton onClick={onCancel} disabled={pending}>
          Cancel
        </SecondaryButton>
        <DangerButton
          disabled={!matches || pending}
          onClick={() => void onConfirm()}
        >
          {pending ? "Deleting…" : "Delete account"}
        </DangerButton>
      </ModalActions>
    </ModalShell>
  );
}

// ---- shared inline primitives (kept local to avoid cross-file coupling) ----

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

const cellHead: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  fontWeight: 600,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--text-secondary)",
};

const cellBody: React.CSSProperties = {
  padding: "8px 10px",
  color: "var(--text-primary)",
};
