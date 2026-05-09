// 0834 T-027 + T-028 — AccountShell.
//
// In-app /account view rendered by the same eval-ui shell that hosts
// the studio editor. Used identically by the Tauri desktop sidebar and
// the npx vskill studio browser tab — parity is the whole point of the
// component-extraction approach (AC-US12-01, AC-US12-02).
//
// State:
//   - active tab is local (useState) — no URL routing, this is in-app
//     navigation. The host can persist via localStorage if it wants.
//   - data + mutations come from useAccount(); offline banner lights up
//     when the profile fetch errored.
//
// Tabs follow the same order as the web /account sidebar so users
// switching surfaces don't have to re-learn anything: Profile · Plan ·
// Repos · Skills · Tokens · Notifications · Danger.

import { useState } from "react";
import {
  ConnectedReposTable,
  DangerZone,
  NotificationsForm,
  PlanCard,
  ProfileForm,
  TokensTable,
} from "./account";
import {
  useAccount,
  useAccountProfile,
  useApiTokens,
  useConnectedRepos,
  useDisconnectRepo,
  useNotificationPrefs,
  useResyncRepo,
  useRevokeToken,
  useCreateToken,
  useUpdateProfile,
  useUpdateNotificationPrefs,
  useSignOutAll,
  useRequestExport,
  useDeleteAccount,
  useAccountExports,
} from "../hooks/useAccount";
import type { TokenCreateResponseDTO } from "../types/account";

export type AccountTabKey =
  | "profile"
  | "billing"
  | "repos"
  | "skills"
  | "tokens"
  | "notifications"
  | "danger";

const TABS: ReadonlyArray<{ key: AccountTabKey; label: string }> = [
  { key: "profile", label: "Profile" },
  { key: "billing", label: "Plan & billing" },
  { key: "repos", label: "Connected repositories" },
  { key: "skills", label: "Skills" },
  { key: "tokens", label: "API tokens" },
  { key: "notifications", label: "Notifications" },
  { key: "danger", label: "Danger zone" },
];

export interface AccountShellProps {
  /**
   * Initial tab — defaults to "profile". Hosts that want deep-linking
   * (e.g. desktop's "Settings → Account → Tokens") pass the key here.
   */
  initialTab?: AccountTabKey;
  /**
   * Whether the network is reachable. When false, `AccountShell`
   * renders an "Offline" banner above the active tab and shows the
   * last cached data (AC-US12-04). Defaults true.
   */
  online?: boolean;
  /**
   * Called when the user clicks "Connect a repository" — the host
   * routes to the platform's pre-flight page (web: /account/repos/connect;
   * desktop: opens the same URL via Tauri shell.open).
   */
  onConnectRepo?: () => void;
  /** Called when the user clicks "Open on GitHub" on a repo row. */
  onOpenRepoOnGitHub?: (url: string) => void;
  /** Called when the user clicks "Upgrade to Pro". Host routes to /pricing. */
  onUpgradeClick?: () => void;
}

export function AccountShell({
  initialTab = "profile",
  online = true,
  onConnectRepo,
  onOpenRepoOnGitHub,
  onUpgradeClick,
}: AccountShellProps) {
  const [tab, setTab] = useState<AccountTabKey>(initialTab);

  return (
    <div
      data-testid="account-shell"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        fontFamily: "var(--font-sans)",
      }}
    >
      <Header />
      {!online && <OfflineBanner />}
      <div
        style={{
          display: "flex",
          flex: 1,
          minHeight: 0,
        }}
      >
        <SideNav activeTab={tab} onSelectTab={setTab} />
        <main
          data-testid="account-shell-pane"
          style={{
            flex: 1,
            overflowY: "auto",
            padding: 24,
            background: "var(--bg-canvas, #f9fafb)",
          }}
        >
          <TabPane
            tab={tab}
            online={online}
            onConnectRepo={onConnectRepo}
            onOpenRepoOnGitHub={onOpenRepoOnGitHub}
            onUpgradeClick={onUpgradeClick}
          />
        </main>
      </div>
    </div>
  );
}

function Header() {
  const { data: profile } = useAccountProfile();
  return (
    <header
      data-testid="account-shell-header"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        borderBottom: "1px solid var(--border-default, #e5e7eb)",
        background: "var(--bg-elevated, #fff)",
      }}
    >
      {profile?.avatarUrl ? (
        <img
          src={profile.avatarUrl}
          alt=""
          width={28}
          height={28}
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            objectFit: "cover",
            border: "1px solid var(--border-default, #e5e7eb)",
          }}
        />
      ) : (
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "var(--bg-canvas, #f3f4f6)",
          }}
        />
      )}
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
        <strong style={{ fontSize: 13, color: "var(--text-primary)" }}>
          {profile?.displayName ?? "Loading…"}
        </strong>
        <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
          {profile ? `@${profile.githubHandle}` : ""}
        </span>
      </div>
    </header>
  );
}

function OfflineBanner() {
  return (
    <div
      role="status"
      data-testid="account-shell-offline-banner"
      style={{
        padding: "8px 16px",
        background: "rgba(245, 158, 11, 0.15)",
        color: "#92400e",
        fontSize: 12,
        borderBottom: "1px solid rgba(245, 158, 11, 0.4)",
      }}
    >
      Offline — showing the last synced data.
    </div>
  );
}

function SideNav({
  activeTab,
  onSelectTab,
}: {
  activeTab: AccountTabKey;
  onSelectTab: (tab: AccountTabKey) => void;
}) {
  return (
    <nav
      data-testid="account-shell-sidenav"
      aria-label="Account sections"
      style={{
        width: 220,
        flexShrink: 0,
        borderRight: "1px solid var(--border-default, #e5e7eb)",
        background: "var(--bg-elevated, #fff)",
        padding: "12px 8px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      {TABS.map((t) => {
        const isActive = activeTab === t.key;
        return (
          <button
            key={t.key}
            type="button"
            data-testid={`account-tab-${t.key}`}
            data-active={isActive ? "true" : "false"}
            onClick={() => onSelectTab(t.key)}
            style={{
              display: "block",
              textAlign: "left",
              padding: "8px 12px",
              fontSize: 13,
              fontFamily: "inherit",
              fontWeight: isActive ? 600 : 400,
              color: "var(--text-primary)",
              background: isActive
                ? "var(--bg-canvas, #f3f4f6)"
                : "transparent",
              border: "none",
              borderLeft: `3px solid ${
                isActive ? "var(--color-accent, #2563eb)" : "transparent"
              }`,
              borderRadius: 0,
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}

function TabPane({
  tab,
  online,
  onConnectRepo,
  onOpenRepoOnGitHub,
  onUpgradeClick,
}: {
  tab: AccountTabKey;
  online: boolean;
  onConnectRepo?: () => void;
  onOpenRepoOnGitHub?: (url: string) => void;
  onUpgradeClick?: () => void;
}) {
  switch (tab) {
    case "profile":
      return <ProfileTab />;
    case "billing":
      return <BillingTab onUpgradeClick={onUpgradeClick} />;
    case "repos":
      return (
        <ReposTab
          online={online}
          onConnectRepo={onConnectRepo}
          onOpenRepoOnGitHub={onOpenRepoOnGitHub}
        />
      );
    case "skills":
      return <SkillsTab />;
    case "tokens":
      return <TokensTab />;
    case "notifications":
      return <NotificationsTab />;
    case "danger":
      return <DangerTab />;
    default: {
      // Exhaustiveness check
      const _: never = tab;
      void _;
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Per-tab containers — each owns its data fetch + error/loading boundary
// ---------------------------------------------------------------------------

function ProfileTab() {
  const { data: profile, loading, error } = useAccountProfile();
  const update = useUpdateProfile();
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (loading || !profile) return <Loading error={error} />;

  return (
    <ProfileForm
      profile={profile}
      saving={saving}
      errorMessage={errorMsg}
      onSubmit={async (patch) => {
        setSaving(true);
        setErrorMsg(null);
        try {
          await update(patch);
        } catch (e) {
          setErrorMsg(e instanceof Error ? e.message : String(e));
        } finally {
          setSaving(false);
        }
      }}
    />
  );
}

function BillingTab({ onUpgradeClick }: { onUpgradeClick?: () => void }) {
  const { data: profile, loading, error } = useAccountProfile();
  if (loading || !profile) return <Loading error={error} />;
  return <PlanCard tier={profile.tier} onUpgradeClick={onUpgradeClick} />;
}

function ReposTab({
  online,
  onConnectRepo,
  onOpenRepoOnGitHub,
}: {
  online: boolean;
  onConnectRepo?: () => void;
  onOpenRepoOnGitHub?: (url: string) => void;
}) {
  const { data: reposList, loading, error } = useConnectedRepos();
  const resync = useResyncRepo();
  const disconnect = useDisconnectRepo();
  const [pending, setPending] = useState<Record<string, "resync" | "disconnect">>(
    {},
  );

  if (loading && !reposList) return <Loading error={error} />;

  return (
    <ConnectedReposTable
      repos={reposList?.repos ?? []}
      pendingActions={pending}
      onConnectNew={() => onConnectRepo?.()}
      onOpenOnGitHub={(repo) => {
        const url = `https://github.com/${repo.repoFullName}`;
        if (onOpenRepoOnGitHub) onOpenRepoOnGitHub(url);
        else if (typeof window !== "undefined") window.open(url, "_blank");
      }}
      onResync={async (repo) => {
        if (!online) return;
        setPending((p) => ({ ...p, [repo.repoId]: "resync" }));
        try {
          await resync(repo.repoId);
        } finally {
          setPending((p) => {
            const next = { ...p };
            delete next[repo.repoId];
            return next;
          });
        }
      }}
      onDisconnect={async (repo) => {
        if (!online) return;
        setPending((p) => ({ ...p, [repo.repoId]: "disconnect" }));
        try {
          await disconnect(repo.repoId);
        } finally {
          setPending((p) => {
            const next = { ...p };
            delete next[repo.repoId];
            return next;
          });
        }
      }}
    />
  );
}

function SkillsTab() {
  // Skills summary tab — minimal v1 per AC-US9-01..03. Full UI lives in
  // the web /account/skills page; the desktop view shows just the
  // counts and a CTA back to the existing skill management surfaces.
  const { skills } = useAccount();
  if (!skills.data) return <Loading error={skills.error} />;
  return (
    <div
      data-testid="account-skills-tab"
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      <div style={{ display: "flex", gap: 12 }}>
        <StatTile label="Public skills" value={skills.data.publicCount} />
        <StatTile label="Private skills" value={skills.data.privateCount} />
      </div>
      <section style={{ marginTop: 8 }}>
        <h3
          style={{
            margin: "0 0 8px",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-primary)",
          }}
        >
          Recent activity
        </h3>
        {skills.data.recentActivity.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)" }}>
            No recent activity.
          </p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {skills.data.recentActivity.map((a, i) => (
              <li
                key={`${a.skillName}-${i}`}
                style={{
                  padding: "6px 0",
                  fontSize: 12,
                  borderBottom: "1px solid var(--border-default, #e5e7eb)",
                  color: "var(--text-primary)",
                }}
              >
                <strong>{a.skillName}</strong>{" "}
                <span style={{ color: "var(--text-secondary)" }}>{a.action}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        flex: 1,
        padding: 16,
        border: "1px solid var(--border-default, #e5e7eb)",
        borderRadius: 8,
        background: "var(--bg-elevated, #fff)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--text-secondary)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 600,
          color: "var(--text-primary)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function TokensTab() {
  const { data: tokens, loading, error } = useApiTokens();
  const create = useCreateToken();
  const revoke = useRevokeToken();
  const [creating, setCreating] = useState(false);
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);
  const [recentlyCreated, setRecentlyCreated] =
    useState<TokenCreateResponseDTO | null>(null);

  if (loading && !tokens) return <Loading error={error} />;

  return (
    <TokensTable
      tokens={tokens ?? []}
      creating={creating}
      pendingRevokeId={pendingRevokeId}
      recentlyCreated={recentlyCreated}
      onDismissRecentlyCreated={() => setRecentlyCreated(null)}
      onCreate={async (input) => {
        setCreating(true);
        try {
          const created = await create(input);
          setRecentlyCreated(created);
        } finally {
          setCreating(false);
        }
      }}
      onRevoke={async (token) => {
        setPendingRevokeId(token.id);
        try {
          await revoke(token.id);
        } finally {
          setPendingRevokeId(null);
        }
      }}
    />
  );
}

function NotificationsTab() {
  const { data: prefs, loading, error } = useNotificationPrefs();
  const update = useUpdateNotificationPrefs();
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (loading || !prefs) return <Loading error={error} />;
  return (
    <NotificationsForm
      prefs={prefs}
      saving={saving}
      errorMessage={errorMsg}
      onSubmit={async (next) => {
        setSaving(true);
        setErrorMsg(null);
        try {
          await update(next);
        } catch (e) {
          setErrorMsg(e instanceof Error ? e.message : String(e));
        } finally {
          setSaving(false);
        }
      }}
    />
  );
}

function DangerTab() {
  const { data: profile } = useAccountProfile();
  const { data: exports } = useAccountExports();
  const signOutAll = useSignOutAll();
  const requestExport = useRequestExport();
  const deleteAccount = useDeleteAccount();
  const [pending, setPending] = useState<{
    signOutAll?: boolean;
    exportRequest?: boolean;
    deleteAccount?: boolean;
  }>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!profile) return <Loading />;

  return (
    <DangerZone
      githubHandle={profile.githubHandle}
      exports={exports ?? []}
      pending={pending}
      errorMessage={errorMsg}
      onSignOutAll={async () => {
        setPending((p) => ({ ...p, signOutAll: true }));
        setErrorMsg(null);
        try {
          await signOutAll();
        } catch (e) {
          setErrorMsg(e instanceof Error ? e.message : String(e));
        } finally {
          setPending((p) => ({ ...p, signOutAll: false }));
        }
      }}
      onExportRequest={async () => {
        setPending((p) => ({ ...p, exportRequest: true }));
        setErrorMsg(null);
        try {
          await requestExport();
        } catch (e) {
          setErrorMsg(e instanceof Error ? e.message : String(e));
        } finally {
          setPending((p) => ({ ...p, exportRequest: false }));
        }
      }}
      onDeleteAccount={async () => {
        setPending((p) => ({ ...p, deleteAccount: true }));
        setErrorMsg(null);
        try {
          await deleteAccount();
        } catch (e) {
          setErrorMsg(e instanceof Error ? e.message : String(e));
        } finally {
          setPending((p) => ({ ...p, deleteAccount: false }));
        }
      }}
    />
  );
}

function Loading({ error }: { error?: Error } = {}) {
  if (error) {
    return (
      <div
        role="alert"
        data-testid="account-shell-tab-error"
        style={{
          padding: 16,
          border: "1px solid rgba(220, 38, 38, 0.4)",
          background: "rgba(220, 38, 38, 0.06)",
          borderRadius: 8,
          color: "#991b1b",
          fontSize: 13,
        }}
      >
        Couldn't load this section: {error.message}
      </div>
    );
  }
  return (
    <div
      data-testid="account-shell-tab-loading"
      style={{
        padding: 16,
        color: "var(--text-secondary)",
        fontSize: 13,
      }}
    >
      Loading…
    </div>
  );
}
