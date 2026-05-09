// 0834 T-025 — ConnectedReposTable.
//
// Rendering-pure list of connected GitHub repositories with status dot,
// last-activity time, and a kebab actions menu. Imported identically by
// the platform's web /account/repos page, the Tauri desktop sidebar
// AccountShell, and the npx studio sidebar. All data fetching happens
// in the host via `useAccount()`; this component takes the resolved
// list + action callbacks as props.
//
// Mobile (<640px): table degrades to a card-list (AC-US5-07). The
// breakpoint is read by the host via `useMediaQuery` and forwarded as
// `viewMode`. Component doesn't sniff window itself — keeps it SSR-safe
// and easier to test.

import { useState } from "react";
import type {
  ConnectedRepoDTO,
  ConnectedReposActions,
  SyncStatusWire,
} from "../../types/account";

export interface ConnectedReposTableProps extends ConnectedReposActions {
  repos: ReadonlyArray<ConnectedRepoDTO>;
  /** "table" (default) or "cards" for mobile breakpoints. */
  viewMode?: "table" | "cards";
  /** Per-repo overlay: id → spinning/disabled flag while resync is pending. */
  pendingActions?: Readonly<Record<string, "resync" | "disconnect">>;
  /** "Now" override for deterministic relative-time tests. */
  now?: Date;
}

const STATUS_COLOURS: Record<SyncStatusWire, string> = {
  green: "#16a34a",
  amber: "#f59e0b",
  grey: "#9ca3af",
  red: "#dc2626",
};

const STATUS_LABELS: Record<SyncStatusWire, string> = {
  green: "Synced",
  amber: "Reauth needed",
  grey: "Idle",
  red: "Error",
};

export function ConnectedReposTable({
  repos,
  viewMode = "table",
  pendingActions,
  onOpenOnGitHub,
  onResync,
  onDisconnect,
  onConnectNew,
  now = new Date(),
}: ConnectedReposTableProps) {
  const summary = summarize(repos);

  return (
    <div data-testid="connected-repos-table" style={{ width: "100%" }}>
      <SummaryChip summary={summary} onConnectNew={onConnectNew} />

      {repos.length === 0 ? (
        <EmptyState onConnectNew={onConnectNew} />
      ) : viewMode === "cards" ? (
        <CardList
          repos={repos}
          pendingActions={pendingActions}
          onOpenOnGitHub={onOpenOnGitHub}
          onResync={onResync}
          onDisconnect={onDisconnect}
          now={now}
        />
      ) : (
        <Table
          repos={repos}
          pendingActions={pendingActions}
          onOpenOnGitHub={onOpenOnGitHub}
          onResync={onResync}
          onDisconnect={onDisconnect}
          now={now}
        />
      )}
    </div>
  );
}

interface RepoSummary {
  total: number;
  publicCount: number;
  privateCount: number;
}

function summarize(repos: ReadonlyArray<ConnectedRepoDTO>): RepoSummary {
  let publicCount = 0;
  let privateCount = 0;
  for (const r of repos) {
    if (r.isPrivate) privateCount++;
    else publicCount++;
  }
  return { total: repos.length, publicCount, privateCount };
}

function SummaryChip({
  summary,
  onConnectNew,
}: {
  summary: RepoSummary;
  onConnectNew: () => void;
}) {
  return (
    <div
      data-testid="repos-summary-chip"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 16px",
        marginBottom: 12,
        background: "var(--bg-canvas, #f9fafb)",
        border: "1px solid var(--border-default, #e5e7eb)",
        borderRadius: 8,
        fontFamily: "var(--font-sans)",
        fontSize: 13,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          color: "var(--text-primary)",
          fontWeight: 500,
        }}
      >
        <strong>{summary.total}</strong>
        <span>{summary.total === 1 ? "repo" : "repos"} connected</span>
        <span aria-hidden style={{ color: "var(--text-tertiary)" }}>·</span>
        <span title="Public repos" aria-label="Public repos">
          🌐 {summary.publicCount} public
        </span>
        <span aria-hidden style={{ color: "var(--text-tertiary)" }}>·</span>
        <span title="Private repos" aria-label="Private repos">
          🔒 {summary.privateCount} private
        </span>
      </div>
      <button
        type="button"
        onClick={onConnectNew}
        data-testid="connect-new-repo-button"
        style={{
          padding: "6px 14px",
          fontSize: 13,
          fontWeight: 500,
          fontFamily: "inherit",
          border: "1px solid var(--color-accent, #2563eb)",
          background: "var(--color-accent, #2563eb)",
          color: "#fff",
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        Connect a repository
      </button>
    </div>
  );
}

function EmptyState({ onConnectNew }: { onConnectNew: () => void }) {
  return (
    <div
      data-testid="repos-empty-state"
      style={{
        textAlign: "center",
        padding: "48px 24px",
        background: "var(--bg-canvas, #f9fafb)",
        border: "1px dashed var(--border-default, #e5e7eb)",
        borderRadius: 8,
        fontFamily: "var(--font-sans)",
      }}
    >
      <div
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: "var(--text-primary)",
          marginBottom: 6,
        }}
      >
        No repositories connected yet
      </div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text-secondary)",
          marginBottom: 16,
        }}
      >
        Connect a GitHub repository to sync skills automatically.
      </div>
      <button
        type="button"
        onClick={onConnectNew}
        style={{
          padding: "8px 16px",
          fontSize: 13,
          fontWeight: 500,
          fontFamily: "inherit",
          border: "1px solid var(--color-accent, #2563eb)",
          background: "var(--color-accent, #2563eb)",
          color: "#fff",
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        Connect a GitHub repo
      </button>
    </div>
  );
}

interface RowsProps {
  repos: ReadonlyArray<ConnectedRepoDTO>;
  pendingActions?: Readonly<Record<string, "resync" | "disconnect">>;
  onOpenOnGitHub: (repo: ConnectedRepoDTO) => void;
  onResync: (repo: ConnectedRepoDTO) => void | Promise<void>;
  onDisconnect: (repo: ConnectedRepoDTO) => void | Promise<void>;
  now: Date;
}

function Table({
  repos,
  pendingActions,
  onOpenOnGitHub,
  onResync,
  onDisconnect,
  now,
}: RowsProps) {
  return (
    <table
      data-testid="repos-table"
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontFamily: "var(--font-sans)",
        fontSize: 13,
      }}
    >
      <thead>
        <tr style={{ borderBottom: "1px solid var(--border-default, #e5e7eb)" }}>
          <Th>Repository</Th>
          <Th align="right">Skills</Th>
          <Th>Status</Th>
          <Th>Last activity</Th>
          <Th align="right" style={{ width: 48 }}>
            <span style={{ visibility: "hidden" }}>Actions</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {repos.map((repo) => (
          <RepoRow
            key={repo.repoId}
            repo={repo}
            pending={pendingActions?.[repo.repoId]}
            onOpenOnGitHub={onOpenOnGitHub}
            onResync={onResync}
            onDisconnect={onDisconnect}
            now={now}
          />
        ))}
      </tbody>
    </table>
  );
}

function CardList({
  repos,
  pendingActions,
  onOpenOnGitHub,
  onResync,
  onDisconnect,
  now,
}: RowsProps) {
  return (
    <div
      data-testid="repos-card-list"
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      {repos.map((repo) => (
        <RepoCard
          key={repo.repoId}
          repo={repo}
          pending={pendingActions?.[repo.repoId]}
          onOpenOnGitHub={onOpenOnGitHub}
          onResync={onResync}
          onDisconnect={onDisconnect}
          now={now}
        />
      ))}
    </div>
  );
}

interface SingleRowProps {
  repo: ConnectedRepoDTO;
  pending?: "resync" | "disconnect";
  onOpenOnGitHub: (repo: ConnectedRepoDTO) => void;
  onResync: (repo: ConnectedRepoDTO) => void | Promise<void>;
  onDisconnect: (repo: ConnectedRepoDTO) => void | Promise<void>;
  now: Date;
}

function RepoRow({
  repo,
  pending,
  onOpenOnGitHub,
  onResync,
  onDisconnect,
  now,
}: SingleRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <tr
      data-testid={`repo-row-${repo.repoId}`}
      style={{
        borderBottom: "1px solid var(--border-default, #e5e7eb)",
      }}
    >
      <Td>
        <RepoIdentity repo={repo} />
      </Td>
      <Td align="right">
        {repo.skillsCount === 0 ? (
          <span style={{ color: "var(--text-tertiary)" }}>—</span>
        ) : (
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {repo.skillsCount}
          </span>
        )}
      </Td>
      <Td>
        <StatusDot status={repo.syncStatus} errorMessage={repo.lastErrorMessage} />
      </Td>
      <Td>
        <span style={{ color: "var(--text-secondary)" }}>
          {relativeTime(repo.lastActivityAt, now)}
        </span>
      </Td>
      <Td align="right">
        <KebabMenu
          repo={repo}
          pending={pending}
          isOpen={menuOpen}
          onToggle={() => setMenuOpen((v) => !v)}
          onClose={() => setMenuOpen(false)}
          onOpenOnGitHub={onOpenOnGitHub}
          onResync={onResync}
          onDisconnect={onDisconnect}
        />
      </Td>
    </tr>
  );
}

function RepoCard({
  repo,
  pending,
  onOpenOnGitHub,
  onResync,
  onDisconnect,
  now,
}: SingleRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      data-testid={`repo-card-${repo.repoId}`}
      style={{
        padding: 14,
        border: "1px solid var(--border-default, #e5e7eb)",
        borderRadius: 8,
        background: "var(--bg-elevated, #fff)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <RepoIdentity repo={repo} />
        <KebabMenu
          repo={repo}
          pending={pending}
          isOpen={menuOpen}
          onToggle={() => setMenuOpen((v) => !v)}
          onClose={() => setMenuOpen(false)}
          onOpenOnGitHub={onOpenOnGitHub}
          onResync={onResync}
          onDisconnect={onDisconnect}
        />
      </div>
      <CardKv label="Skills">
        {repo.skillsCount === 0 ? "—" : String(repo.skillsCount)}
      </CardKv>
      <CardKv label="Status">
        <StatusDot status={repo.syncStatus} errorMessage={repo.lastErrorMessage} />
      </CardKv>
      <CardKv label="Last activity">{relativeTime(repo.lastActivityAt, now)}</CardKv>
    </div>
  );
}

function RepoIdentity({ repo }: { repo: ConnectedRepoDTO }) {
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}
    >
      <span
        aria-label={repo.isPrivate ? "Private repo" : "Public repo"}
        title={repo.isPrivate ? "Private" : "Public"}
        style={{ fontSize: 14, lineHeight: 1 }}
      >
        {repo.isPrivate ? "🔒" : "🌐"}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          color: "var(--text-primary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {repo.repoFullName}
      </span>
    </div>
  );
}

function StatusDot({
  status,
  errorMessage,
}: {
  status: SyncStatusWire;
  errorMessage: string | null;
}) {
  const colour = STATUS_COLOURS[status];
  const label = STATUS_LABELS[status];
  const tooltip = status === "red" && errorMessage ? errorMessage : label;
  return (
    <span
      data-testid={`status-${status}`}
      title={tooltip}
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: colour,
          display: "inline-block",
        }}
      />
      <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        {label}
      </span>
    </span>
  );
}

function CardKv({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: 12,
      }}
    >
      <span style={{ color: "var(--text-tertiary)" }}>{label}</span>
      <span style={{ color: "var(--text-primary)" }}>{children}</span>
    </div>
  );
}

interface KebabProps {
  repo: ConnectedRepoDTO;
  pending?: "resync" | "disconnect";
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onOpenOnGitHub: (repo: ConnectedRepoDTO) => void;
  onResync: (repo: ConnectedRepoDTO) => void | Promise<void>;
  onDisconnect: (repo: ConnectedRepoDTO) => void | Promise<void>;
}

function KebabMenu({
  repo,
  pending,
  isOpen,
  onToggle,
  onClose,
  onOpenOnGitHub,
  onResync,
  onDisconnect,
}: KebabProps) {
  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        aria-label={`Actions for ${repo.repoFullName}`}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        data-testid={`kebab-${repo.repoId}`}
        onClick={onToggle}
        disabled={pending === "disconnect"}
        style={{
          width: 28,
          height: 28,
          padding: 0,
          border: "1px solid transparent",
          background: "transparent",
          borderRadius: 4,
          cursor: pending === "disconnect" ? "not-allowed" : "pointer",
          color: "var(--text-secondary)",
          fontSize: 16,
          lineHeight: 1,
        }}
      >
        ⋯
      </button>
      {isOpen && (
        <div
          role="menu"
          data-testid={`kebab-menu-${repo.repoId}`}
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 4,
            minWidth: 180,
            background: "var(--bg-elevated, #fff)",
            border: "1px solid var(--border-default, #e5e7eb)",
            borderRadius: 6,
            boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
            zIndex: 10,
            padding: 4,
          }}
        >
          <KebabItem
            onClick={() => {
              onOpenOnGitHub(repo);
              onClose();
            }}
          >
            Open on GitHub
          </KebabItem>
          <KebabItem
            disabled={pending === "resync"}
            onClick={async () => {
              await onResync(repo);
              onClose();
            }}
          >
            {pending === "resync" ? "Resyncing…" : "Resync now"}
          </KebabItem>
          <KebabItem
            danger
            onClick={async () => {
              await onDisconnect(repo);
              onClose();
            }}
          >
            Disconnect
          </KebabItem>
        </div>
      )}
    </div>
  );
}

function KebabItem({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "6px 10px",
        fontSize: 13,
        fontFamily: "inherit",
        background: "transparent",
        border: "none",
        borderRadius: 4,
        cursor: disabled ? "not-allowed" : "pointer",
        color: danger ? "#dc2626" : "var(--text-primary)",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  );
}

function Th({
  children,
  align = "left",
  style,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  style?: React.CSSProperties;
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
        ...style,
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

/** Pure relative-time formatter. Exported for tests. */
export function relativeTime(iso: string | null, now: Date): string {
  if (!iso) return "Never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Never";
  const diffMs = now.getTime() - then;
  if (diffMs < 0) return "Just now";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "Just now";
  const min = Math.floor(sec / 60);
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
