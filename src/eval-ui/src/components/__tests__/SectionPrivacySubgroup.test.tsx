// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0848 T-003 — SidebarSection sub-grouping by repo visibility.
//
//   - Mixed (private + public) section → renders "🔒 Private repos (N)" and
//     "🌐 Public repos (N)" collapsible sub-headers.
//   - Single-class section → renders children unchanged (no sub-headers).
//   - Collapse state persists under
//     vskill-sidebar-{agent}-section-{name}-private-collapsed.
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { SkillInfo } from "../../types";
import type { ConnectedRepoDTO } from "../../types/account";

function makeSkill(over: Partial<SkillInfo> = {}): SkillInfo {
  return {
    plugin: "demo",
    skill: "alpha",
    dir: "/tmp/demo/alpha",
    hasEvals: false,
    hasBenchmark: false,
    evalCount: 0,
    assertionCount: 0,
    benchmarkStatus: "missing",
    lastBenchmark: null,
    origin: "source",
    ...over,
  };
}

function makeRepo(over: Partial<ConnectedRepoDTO> & { repoFullName: string; isPrivate: boolean }): ConnectedRepoDTO {
  return {
    repoId: over.repoFullName,
    ownerLogin: over.repoFullName.split("/")[0],
    ownerAvatarUrl: "",
    repoName: over.repoFullName.split("/")[1],
    skillsCount: 1,
    syncStatus: "green" as ConnectedRepoDTO["syncStatus"],
    lastSyncedAt: null,
    lastActivityAt: null,
    lastErrorMessage: null,
    githubInstallationId: "1",
    ...over,
  };
}

function buildLookup(repos: ConnectedRepoDTO[]): Map<string, ConnectedRepoDTO> {
  const m = new Map<string, ConnectedRepoDTO>();
  for (const r of repos) m.set(r.repoFullName.toLowerCase(), r);
  return m;
}

describe("SectionPrivacySubgroup — 0848 T-003", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("renders private + public sub-headers when the section mixes visibility", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { SectionPrivacySubgroup } = await import("../SectionPrivacySubgroup");

    const lookup = buildLookup([
      makeRepo({ repoFullName: "acme/secret", isPrivate: true }),
      makeRepo({ repoFullName: "acme/open", isPrivate: false }),
    ]);
    const items: Array<[string, SkillInfo[]]> = [
      ["demo", [
        makeSkill({ skill: "priv-one", repoUrl: "https://github.com/acme/secret" }),
        makeSkill({ skill: "pub-one", repoUrl: "https://github.com/acme/open" }),
      ]],
    ];

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(
          SectionPrivacySubgroup,
          { items, agentId: "claude-cli", sectionName: "own", repoVisibilityLookup: lookup, selectedKey: null, onSelect: () => {} },
          React.createElement("div", { "data-testid": "fallback" }, "fallback"),
        ),
      );
    });

    expect(container.querySelector("[data-testid='sidebar-subgroup-private']")).toBeTruthy();
    expect(container.querySelector("[data-testid='sidebar-subgroup-public']")).toBeTruthy();
    expect(container.textContent).toContain("Private repos");
    expect(container.textContent).toContain("Public repos");
    // (1) per class
    expect(container.textContent).toContain("(1)");
    // Fallback children should NOT render in the mixed case.
    expect(container.querySelector("[data-testid='fallback']")).toBeFalsy();

    act(() => root.unmount());
    container.remove();
  });

  it("renders children unchanged (no sub-headers) for a single-class section", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { SectionPrivacySubgroup } = await import("../SectionPrivacySubgroup");

    // All public → no sub-headers.
    const lookup = buildLookup([makeRepo({ repoFullName: "acme/open", isPrivate: false })]);
    const items: Array<[string, SkillInfo[]]> = [
      ["demo", [makeSkill({ skill: "pub-one", repoUrl: "https://github.com/acme/open" })]],
    ];

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(
          SectionPrivacySubgroup,
          { items, agentId: "claude-cli", sectionName: "own", repoVisibilityLookup: lookup, selectedKey: null, onSelect: () => {} },
          React.createElement("div", { "data-testid": "fallback" }, "fallback"),
        ),
      );
    });

    expect(container.querySelector("[data-testid='sidebar-subgroup-private']")).toBeFalsy();
    expect(container.querySelector("[data-testid='fallback']")).toBeTruthy();

    act(() => root.unmount());
    container.remove();
  });

  it("persists private sub-group collapse under the agent/section-scoped key", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { SectionPrivacySubgroup } = await import("../SectionPrivacySubgroup");

    const lookup = buildLookup([
      makeRepo({ repoFullName: "acme/secret", isPrivate: true }),
      makeRepo({ repoFullName: "acme/open", isPrivate: false }),
    ]);
    const items: Array<[string, SkillInfo[]]> = [
      ["demo", [
        makeSkill({ skill: "priv-one", repoUrl: "https://github.com/acme/secret" }),
        makeSkill({ skill: "pub-one", repoUrl: "https://github.com/acme/open" }),
      ]],
    ];

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(
          SectionPrivacySubgroup,
          { items, agentId: "claude-cli", sectionName: "own", repoVisibilityLookup: lookup, selectedKey: null, onSelect: () => {} },
          React.createElement("div", null, "fallback"),
        ),
      );
    });

    const privateHeader = container.querySelector("[data-testid='sidebar-subgroup-private']") as HTMLButtonElement;
    expect(privateHeader).toBeTruthy();
    act(() => privateHeader.click());
    expect(localStorage.getItem("vskill-sidebar-claude-cli-section-own-private-collapsed")).toBe("true");

    act(() => root.unmount());
    container.remove();
  });
});
