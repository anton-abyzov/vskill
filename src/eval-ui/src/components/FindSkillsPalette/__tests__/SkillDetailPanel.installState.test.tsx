// @vitest-environment jsdom
// 0827 — SkillDetailPanel install-state-aware UI behavior.
//
// Coverage:
//   - AC-US1-01/02: scope picker exposes Project + User only (no Global).
//   - AC-US1-03   : User scope's copy command renders ` --global`; project
//                   keeps `--scope project`.
//   - AC-US2-01..04: per-scope disabled state, ✓ marker, tooltip copy.
//   - AC-US3-01..03: primary CTA disables when selected scope is installed,
//                   re-enables on scope switch, and updates after a
//                   `studio:skill-installed` event.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface MountHandle {
  container: HTMLElement;
  unmount: () => Promise<void>;
}

let originalFetch: typeof fetch | undefined;

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response;
}

interface InstallStateFixture {
  project?: { installed: boolean; installedAgentTools?: string[]; version?: string | null };
  user?: { installed: boolean; installedAgentTools?: string[]; version?: string | null };
  detectedAgentTools?: Array<{ id: string; displayName: string; localDir: string; globalDir: string }>;
}

function buildInstallState(fx: InstallStateFixture, skill = "obsidian/brain/wiki-sync") {
  return {
    skill,
    detectedAgentTools: fx.detectedAgentTools ?? [
      { id: "claude-code", displayName: "Claude Code", localDir: ".claude/skills", globalDir: "~/.claude/skills" },
      { id: "cursor", displayName: "Cursor", localDir: ".cursor/skills", globalDir: "~/.cursor/skills" },
    ],
    scopes: {
      project: {
        installed: fx.project?.installed ?? false,
        installedAgentTools: fx.project?.installedAgentTools ?? [],
        version: fx.project?.version ?? null,
      },
      user: {
        installed: fx.user?.installed ?? false,
        installedAgentTools: fx.user?.installedAgentTools ?? [],
        version: fx.user?.version ?? null,
      },
    },
  };
}

function makeFetchMock(installState: ReturnType<typeof buildInstallState>) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.startsWith("/api/studio/install-state")) return Promise.resolve(jsonResponse(installState));
    if (url.endsWith("/versions")) return Promise.resolve(jsonResponse({ versions: [{ version: "1.0.0", isLatest: true }] }));
    if (url.includes("/api/v1/skills/")) return Promise.resolve(jsonResponse({ displayName: "Wiki Sync", description: "", trustTier: "T3", certTier: "VERIFIED", repoUrl: "https://github.com/obsidian/brain" }));
    return Promise.resolve(jsonResponse({}));
  }) as unknown as typeof fetch;
}

async function mount(): Promise<MountHandle> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { SkillDetailPanel } = await import("../SkillDetailPanel");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(SkillDetailPanel, {
        selectedSkill: { owner: "obsidian", repo: "brain", slug: "wiki-sync", displayName: "Wiki Sync" },
        onClose: () => {},
      }),
    );
  });
  return {
    container,
    async unmount() {
      await act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

async function flushMicrotasks() {
  const { act } = await import("react");
  await act(async () => {
    for (let i = 0; i < 16; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  if (originalFetch) globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("0827 — SkillDetailPanel scope picker (US-001)", () => {
  it("AC-US1-01/02: only Project and User pills are rendered (Global is gone)", async () => {
    globalThis.fetch = makeFetchMock(buildInstallState({}));
    const h = await mount();
    await flushMicrotasks();

    const project = h.container.querySelector("[data-testid='skill-detail-install-scope-project']");
    const user = h.container.querySelector("[data-testid='skill-detail-install-scope-user']");
    const global = h.container.querySelector("[data-testid='skill-detail-install-scope-global']");
    expect(project).toBeTruthy();
    expect(user).toBeTruthy();
    expect(global).toBeNull();

    await h.unmount();
  });

  it("AC-US1-03: User scope renders the npm copy command with ` --global`, not `--scope user`", async () => {
    globalThis.fetch = makeFetchMock(buildInstallState({}));
    const h = await mount();
    await flushMicrotasks();

    // Switch to User
    const userBtn = h.container.querySelector<HTMLButtonElement>("[data-testid='skill-detail-install-scope-user']");
    expect(userBtn).toBeTruthy();
    const { act } = await import("react");
    await act(async () => { userBtn!.click(); });
    await flushMicrotasks();

    const npmCmd = h.container.querySelector<HTMLElement>("[data-testid='skill-detail-install-variant-cmd-npm']");
    expect(npmCmd?.textContent).toContain(" --global");
    expect(npmCmd?.textContent).not.toContain("--scope user");

    await h.unmount();
  });

  it("AC-US1-03: Project scope keeps the `--scope project` flag", async () => {
    globalThis.fetch = makeFetchMock(buildInstallState({}));
    const h = await mount();
    await flushMicrotasks();

    const npmCmd = h.container.querySelector<HTMLElement>("[data-testid='skill-detail-install-variant-cmd-npm']");
    expect(npmCmd?.textContent).toContain("--scope project");
    expect(npmCmd?.textContent).not.toContain("--global");

    await h.unmount();
  });

  it("AC-US1-04: User pill tooltip lists the per-tool global destination dirs", async () => {
    globalThis.fetch = makeFetchMock(buildInstallState({}));
    const h = await mount();
    await flushMicrotasks();

    const userBtn = h.container.querySelector<HTMLButtonElement>("[data-testid='skill-detail-install-scope-user']");
    const title = userBtn?.getAttribute("title") ?? "";
    // The tooltip enumerates the actual destination paths — that IS the
    // explanation of what `--global` does, no jargon needed. Anti-pattern
    // guard from user feedback: list ONLY detected tools, never claim
    // folders are created for 40 unrelated tools.
    expect(title).toMatch(/Will install to:/);
    expect(title).toMatch(/~\/\.claude\/skills/);
    expect(title).toMatch(/~\/\.cursor\/skills/);

    await h.unmount();
  });

  it("AC-US1-05: Project pill tooltip lists per-repo destination dirs prefixed with ./", async () => {
    globalThis.fetch = makeFetchMock(buildInstallState({}));
    const h = await mount();
    await flushMicrotasks();

    const projectBtn = h.container.querySelector<HTMLButtonElement>("[data-testid='skill-detail-install-scope-project']");
    const title = projectBtn?.getAttribute("title") ?? "";
    expect(title).toMatch(/Will install to:/);
    expect(title).toMatch(/\.\/\.claude\/skills/);
    expect(title).toMatch(/\.\/\.cursor\/skills/);

    await h.unmount();
  });
});

describe("0827 — SkillDetailPanel installed-state UI (US-002)", () => {
  it("AC-US2-01: Project pill is disabled with a ✓ marker when project lockfile has the skill", async () => {
    globalThis.fetch = makeFetchMock(buildInstallState({
      project: { installed: true, version: "2.0.12", installedAgentTools: ["claude-code"] },
    }));
    const h = await mount();
    await flushMicrotasks();

    const projectBtn = h.container.querySelector<HTMLButtonElement>("[data-testid='skill-detail-install-scope-project']");
    expect(projectBtn?.getAttribute("aria-disabled")).toBe("true");
    expect(projectBtn?.getAttribute("data-installed")).toBe("true");
    expect(projectBtn?.textContent).toMatch(/✓/);

    await h.unmount();
  });

  it("AC-US2-02: User pill is disabled with a ✓ marker when ~/.agents/vskill.lock has the skill", async () => {
    globalThis.fetch = makeFetchMock(buildInstallState({
      user: { installed: true, version: "2.0.12", installedAgentTools: ["claude-code"] },
    }));
    const h = await mount();
    await flushMicrotasks();

    const userBtn = h.container.querySelector<HTMLButtonElement>("[data-testid='skill-detail-install-scope-user']");
    expect(userBtn?.getAttribute("aria-disabled")).toBe("true");
    expect(userBtn?.getAttribute("data-installed")).toBe("true");
    expect(userBtn?.textContent).toMatch(/✓/);

    await h.unmount();
  });

  it("AC-US2-06: installed pill tooltip uses `Installed v<version> · <agent ids>` form", async () => {
    globalThis.fetch = makeFetchMock(buildInstallState({
      user: { installed: true, version: "2.0.12", installedAgentTools: ["claude-code", "cursor"] },
    }));
    const h = await mount();
    await flushMicrotasks();

    const userBtn = h.container.querySelector<HTMLButtonElement>("[data-testid='skill-detail-install-scope-user']");
    const title = userBtn?.getAttribute("title") ?? "";
    expect(title).toBe("Installed v2.0.12 · claude-code, cursor");

    await h.unmount();
  });

  it("AC-US2-07: tooltip omits the version segment when the lockfile entry has no recorded version", async () => {
    globalThis.fetch = makeFetchMock(buildInstallState({
      user: { installed: true, version: null, installedAgentTools: ["claude-code"] },
    }));
    const h = await mount();
    await flushMicrotasks();

    const userBtn = h.container.querySelector<HTMLButtonElement>("[data-testid='skill-detail-install-scope-user']");
    const title = userBtn?.getAttribute("title") ?? "";
    expect(title).toBe("Installed · claude-code");

    await h.unmount();
  });

  it("AC-US2-04: clicking a disabled pill does not change scope state", async () => {
    globalThis.fetch = makeFetchMock(buildInstallState({
      project: { installed: true, version: "1.0.0" },
    }));
    const h = await mount();
    await flushMicrotasks();

    const npmCmdBefore = h.container.querySelector<HTMLElement>("[data-testid='skill-detail-install-variant-cmd-npm']")?.textContent ?? "";
    expect(npmCmdBefore).toContain("--scope project");

    // Default scope=project. Switch to User explicitly to start from a known
    // state, then click the (installed) Project pill and confirm scope did
    // not flip back.
    const { act } = await import("react");
    const userBtn = h.container.querySelector<HTMLButtonElement>("[data-testid='skill-detail-install-scope-user']");
    await act(async () => { userBtn!.click(); });
    await flushMicrotasks();

    const projectBtn = h.container.querySelector<HTMLButtonElement>("[data-testid='skill-detail-install-scope-project']");
    await act(async () => { projectBtn!.click(); });
    await flushMicrotasks();

    const npmCmdAfter = h.container.querySelector<HTMLElement>("[data-testid='skill-detail-install-variant-cmd-npm']")?.textContent ?? "";
    expect(npmCmdAfter).toContain(" --global"); // still on User
    expect(npmCmdAfter).not.toContain("--scope project");

    await h.unmount();
  });
});

describe("0827 — SkillDetailPanel primary CTA (US-003)", () => {
  it("AC-US3-01: primary Install button is disabled with `Installed` copy when selected scope is installed", async () => {
    globalThis.fetch = makeFetchMock(buildInstallState({
      project: { installed: true, version: "2.0.12" },
    }));
    const h = await mount();
    await flushMicrotasks();

    const cta = h.container.querySelector<HTMLButtonElement>("[data-testid='skill-detail-install-primary']");
    expect(cta?.disabled).toBe(true);
    expect(cta?.getAttribute("data-installed")).toBe("true");
    expect(cta?.textContent).toMatch(/Installed/);
    expect(cta?.textContent).toMatch(/v2\.0\.12/);

    await h.unmount();
  });

  it("AC-US3-02: primary CTA re-enables when the user switches to a non-installed scope", async () => {
    globalThis.fetch = makeFetchMock(buildInstallState({
      project: { installed: true, version: "2.0.12" },
      // user: not installed
    }));
    const h = await mount();
    await flushMicrotasks();

    let cta = h.container.querySelector<HTMLButtonElement>("[data-testid='skill-detail-install-primary']");
    expect(cta?.disabled).toBe(true);

    const { act } = await import("react");
    const userBtn = h.container.querySelector<HTMLButtonElement>("[data-testid='skill-detail-install-scope-user']");
    await act(async () => { userBtn!.click(); });
    await flushMicrotasks();

    cta = h.container.querySelector<HTMLButtonElement>("[data-testid='skill-detail-install-primary']");
    expect(cta?.disabled).toBe(false);
    expect(cta?.textContent).toMatch(/^Install$/);

    await h.unmount();
  });

  it("AC-US3-03: panel re-fetches install-state after a `studio:skill-installed` event matching this skill", async () => {
    let callCount = 0;
    let stateAfterInstall = false;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("/api/studio/install-state")) {
        callCount++;
        return Promise.resolve(jsonResponse(buildInstallState({
          user: stateAfterInstall ? { installed: true, version: "2.0.12" } : { installed: false },
        })));
      }
      if (url.endsWith("/versions")) return Promise.resolve(jsonResponse({ versions: [{ version: "1.0.0", isLatest: true }] }));
      return Promise.resolve(jsonResponse({ displayName: "Wiki Sync", description: "" }));
    }) as unknown as typeof fetch;

    const h = await mount();
    await flushMicrotasks();
    expect(callCount).toBeGreaterThanOrEqual(1);

    const userBtnInitial = h.container.querySelector<HTMLButtonElement>("[data-testid='skill-detail-install-scope-user']");
    expect(userBtnInitial?.getAttribute("data-installed")).toBe("false");

    // Simulate a successful install firing the event (handleInstall path).
    stateAfterInstall = true;
    const { act } = await import("react");
    await act(async () => {
      window.dispatchEvent(new CustomEvent("studio:skill-installed", {
        detail: { skill: "obsidian/brain/wiki-sync", scope: "global" },
      }));
    });
    // The listener debounces re-fetch by 50ms to coalesce SSE done-frames —
    // wait it out before assertions.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 75));
    });
    await flushMicrotasks();

    const userBtnAfter = h.container.querySelector<HTMLButtonElement>("[data-testid='skill-detail-install-scope-user']");
    expect(userBtnAfter?.getAttribute("data-installed")).toBe("true");
    expect(userBtnAfter?.textContent).toMatch(/✓/);

    await h.unmount();
  });
});
