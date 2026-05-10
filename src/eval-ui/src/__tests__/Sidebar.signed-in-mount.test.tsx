// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0843 T-001 — RED: Sidebar mounts ConnectedRepoWidget for signed-in users.
//
// Asserts the contract from US-001:
//   - When `useAccountSummary()` reports `signedIn:true`, Sidebar renders
//     <ConnectedRepoWidget> in the project-section header right slot.
//   - When `signedIn:false`, the existing <SidebarGitHubIndicator> CTA
//     remains in place — no behavior regression for signed-out users.
//   - The widget mount path is gated entirely on signedIn — switching the
//     hook flips the rendered surface without touching any other Sidebar
//     code path.
//
// We mock the new `useAccountSummary` hook so this test can run before its
// implementation lands (the test fails until T-002 wires the hook + mount).
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SkillInfo } from "../types";

// Hoist mocks so vi.mock() picks them up before module evaluation.
const accountSummary = vi.hoisted(() => ({
  signedIn: false as boolean,
  login: null as string | null,
  avatarUrl: null as string | null,
  tier: "free" as "free" | "pro" | "enterprise",
}));

vi.mock("../hooks/useAccountSummary", () => ({
  useAccountSummary: () => accountSummary,
}));

// ConnectedRepoWidget reads from a polling IPC; stub the real component to a
// data-testid'd marker so we can assert mounted vs. not without booting Tauri.
vi.mock("../components/ConnectedRepoWidget", () => ({
  ConnectedRepoWidget: ({ folder, tier }: { folder: string | null; tier?: string | null }) => (
    <span
      data-testid="connected-repo-widget-stub"
      data-folder={folder ?? ""}
      data-tier={tier ?? ""}
    />
  ),
}));

// SidebarGitHubIndicator's hook hits a (Tauri-only) IPC; stub to a marker.
vi.mock("../components/SidebarGitHubIndicator", () => ({
  SidebarGitHubIndicator: ({ projectRoot }: { projectRoot: string }) => (
    <span data-testid="sidebar-github-indicator-stub" data-project-root={projectRoot} />
  ),
}));

import { Sidebar } from "../components/Sidebar";

function skill(plugin: string, name: string, scope: "own" | "installed" | "global"): SkillInfo {
  return {
    plugin,
    skill: name,
    dir: `/fake/${plugin}/${name}`,
    hasEvals: false,
    hasBenchmark: false,
    origin: scope === "own" ? "source" : "installed",
    scope,
  } as unknown as SkillInfo;
}

describe("0843 US-001 — Sidebar signed-in mount of ConnectedRepoWidget", () => {
  beforeEach(() => {
    accountSummary.signedIn = false;
    accountSummary.login = null;
    accountSummary.avatarUrl = null;
    accountSummary.tier = "free";
  });

  it("renders <ConnectedRepoWidget> in the project section when signedIn is true", () => {
    accountSummary.signedIn = true;
    accountSummary.login = "octocat";
    accountSummary.tier = "pro";

    const html = renderToStaticMarkup(
      <Sidebar
        skills={[skill("a", "s1", "installed")]}
        selectedKey={null}
        onSelect={vi.fn()}
        activeAgentId="claude-code"
      />,
    );

    expect(html).toContain('data-testid="connected-repo-widget-stub"');
    expect(html).not.toContain('data-testid="sidebar-github-indicator-stub"');
  });

  it("renders <SidebarGitHubIndicator> (existing fallback) when signedIn is false", () => {
    accountSummary.signedIn = false;

    const html = renderToStaticMarkup(
      <Sidebar
        skills={[skill("a", "s1", "installed")]}
        selectedKey={null}
        onSelect={vi.fn()}
        activeAgentId="claude-code"
      />,
    );

    expect(html).toContain('data-testid="sidebar-github-indicator-stub"');
    expect(html).not.toContain('data-testid="connected-repo-widget-stub"');
  });

  it("does NOT render the widget when activeAgentId is not claude-code (existing isClaudeCode gate)", () => {
    accountSummary.signedIn = true;

    const html = renderToStaticMarkup(
      <Sidebar
        skills={[skill("a", "s1", "installed")]}
        selectedKey={null}
        onSelect={vi.fn()}
        activeAgentId="cursor"
      />,
    );

    expect(html).not.toContain('data-testid="connected-repo-widget-stub"');
    expect(html).not.toContain('data-testid="sidebar-github-indicator-stub"');
  });
});
