// @vitest-environment jsdom
// 0850 T-012: exercise the actual target modal from the discovery detail.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SkillDetailPanel } from "../SkillDetailPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Scope = "project" | "user";
type ScopeState = { installed: boolean; version: string | null; installedAgentTools: string[] };
const skill = "fixture/repo/example";
const empty = (): ScopeState => ({ installed: false, version: null, installedAgentTools: [] });
const installed = (version = "1.2.3"): ScopeState => ({ installed: true, version, installedAgentTools: ["claude-code"] });
let scopes: Record<Scope, ScopeState>;
let posts: Array<{ url: string; body: { skill: string; scope: Scope; agentIds: string[] } }>;
let root: Root | undefined;
let host: HTMLElement;
let partial: boolean;
let failAll: boolean;
let refuseRemove: boolean;
let metadata: Record<string, unknown>;
let versions: Array<{ version: string; isLatest?: boolean; publishedAt: string }>;
let stateReads: number;
const onSkillsChanged = vi.fn();
const onToast = vi.fn();
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
const get = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const primary = () => get("skill-detail-install-primary") as HTMLButtonElement;
const badge = () => get("install-targets-status-badge-claude-code");
async function click(testid: string) {
  const el = get(testid);
  expect(el, testid).toBeTruthy();
  await act(async () => { el!.click(); });
}
async function settle() {
  // The modal success callback and panel state event are deferred/debounced.
  await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
}
async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(SkillDetailPanel, {
    selectedSkill: { owner: "fixture", repo: "repo", slug: "example", displayName: "Example" },
    activeAgentId: "claude-code", onClose: vi.fn(), onSkillsChanged, onToast,
  })));
}

beforeEach(() => {
  scopes = { project: empty(), user: empty() };
  posts = []; partial = false; failAll = false; refuseRemove = false; stateReads = 0;
  metadata = { displayName: "Example", ownerSlug: "fixture", repoSlug: "repo", skillSlug: "example" };
  versions = [
    { version: "1.2.10", isLatest: true, publishedAt: "2026-10-20" },
    { version: "1.2.3", publishedAt: "2026-10-19" },
    { version: "1.2.2", publishedAt: "2026-10-18" },
  ];
  window.localStorage.clear(); window.sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/studio/install-state")) {
      stateReads++;
      return json({ skill, scopes, detectedAgentTools: [] });
    }
    if (url === "/api/studio/supported-agents") return json({ agents: [
      { id: "claude-code", displayName: "Claude Code", tier: 1, detected: true, installMode: "filesystem", resolvedLocalDir: "/fixture/project/.claude/skills", resolvedGlobalDir: "/fixture/home/.claude/skills" },
      { id: "cursor", displayName: "Cursor", tier: 1, detected: true, installMode: "filesystem", resolvedLocalDir: "/fixture/project/.cursor/skills", resolvedGlobalDir: "/fixture/home/.cursor/skills" },
    ] });
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      posts.push({ url, body });
      if (url === "/api/studio/remove-skill") {
        if (refuseRemove) return json({ removed: [], errors: [], skipped: [{ agentId: "claude-code", reason: "Shared with cursor", sharedWith: ["cursor"] }] });
        scopes[body.scope as Scope] = empty();
        return json({ removed: ["claude-code"], errors: [], skipped: [] });
      }
      if (url === "/api/studio/install-skill") return json({ jobId: "job" });
      throw new Error(`Unexpected write ${url}`);
    }
    if (url === "/api/studio/install-skill/job/stream") {
      const scope = posts[posts.length - 1].body.scope;
      if (!failAll) scopes[scope] = installed("1.2.10");
      const results = failAll
        ? [{ agentId: "claude-code", status: "error", detail: "disk full" }]
        : [{ agentId: "claude-code", status: "installed", path: `/fixture/${scope}/example` }, ...(partial ? [{ agentId: "cursor", status: "error", detail: "permission denied" }] : [])];
      return new Response(`event: done\ndata: ${JSON.stringify({ success: !partial && !failAll, results })}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
    }
    if (url.endsWith("/versions")) return json({ versions });
    if (url.startsWith("/api/v1/skills/")) return json(metadata);
    throw new Error(`Unexpected read ${url}`);
  }));
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined; host?.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks();
});

describe("0850 discovery management", () => {
  it.each(["project", "user"] as const)("opens installed %s with no write and selected-version badges", async (scope) => {
    scopes[scope] = installed();
    await mount();
    await click(`skill-detail-install-scope-${scope}`);
    expect(primary().disabled).toBe(false);
    expect(primary().textContent).toBe("Manage (v1.2.3)");
    const reads = stateReads;
    await click("skill-detail-install-primary");
    expect(stateReads).toBeGreaterThan(reads);
    expect(posts).toEqual([]);
    expect(badge()?.textContent).toContain("Update available v1.2.3 → v1.2.10");
    expect(get("install-targets-path-claude-code")?.textContent).toBe(`/fixture/${scope === "project" ? "project" : "home"}/.claude/skills`);
    await click("install-targets-modal-cancel");
    for (const [version, label] of [["1.2.3", "Installed v1.2.3"], ["1.2.2", "Newer installed v1.2.3"]]) {
      await act(async () => { document.querySelector<HTMLElement>(`[data-version="${version}"]`)!.click(); });
      await click("skill-detail-install-primary");
      expect(badge()?.textContent).toContain(label);
      await click("install-targets-modal-cancel");
    }
    expect(posts).toEqual([]);
  });

  it.each(["project", "user"] as const)("removes then reinstalls %s while preserving the other scope", async (scope) => {
    scopes = { project: installed(), user: installed() };
    const other = scope === "project" ? "user" : "project";
    await mount();
    await click(`skill-detail-install-scope-${scope}`);
    await click("skill-detail-install-primary");
    await click("install-targets-remove-claude-code");
    await settle();
    expect(badge()?.dataset.badgeKind).toBe("installed-other-scope");
    expect(badge()?.textContent).toContain(`(${other} scope)`);
    expect(get("install-targets-remove-claude-code")).toBeNull();
    expect(primary().textContent).toBe("Install");
    expect(posts[0]).toEqual({ url: "/api/studio/remove-skill", body: { skill, scope, agentIds: ["claude-code"] } });
    expect(scopes[other]).toEqual(installed());
    expect(onSkillsChanged).toHaveBeenCalledOnce();
    await click("install-targets-modal-cancel");
    await click("skill-detail-install-primary");
    await click("install-targets-modal-install");
    await settle();
    expect(get("install-targets-modal-done")).toBeTruthy();
    expect(primary().textContent).toBe("Manage (v1.2.10)");
    expect(badge()?.textContent).toContain("Installed v1.2.10");
    expect(posts[1]).toEqual({ url: "/api/studio/install-skill", body: { skill, scope, agentIds: ["claude-code"] } });
    expect(scopes[other]).toEqual(installed());
    await click("install-targets-modal-done");
    await click("skill-detail-install-primary");
    expect(badge()?.textContent).toContain("Installed v1.2.10");
    // Merely reopening management did not repeat the mutation.
    expect(posts).toHaveLength(2);
  });

  it("updates through management and keeps a refused shared removal visible", async () => {
    scopes.project = installed();
    await mount();
    await click("skill-detail-install-primary");
    await click("install-targets-modal-install");
    await settle();
    expect(badge()?.textContent).toContain("Installed v1.2.10");
    await click("install-targets-modal-done");
    refuseRemove = true;
    await click("skill-detail-install-primary");
    await click("install-targets-remove-claude-code");
    await settle();
    expect(get("install-targets-remove-shared")?.textContent).toContain("cursor");
    expect(primary().textContent).toBe("Manage (v1.2.10)");
    expect(badge()?.textContent).toContain("Installed v1.2.10");
  });

  it("refreshes Manage after partial success while retaining error details and Done", async () => {
    partial = true;
    await mount();
    await click("skill-detail-install-primary");
    await click("install-targets-checkbox-cursor");
    await click("install-targets-modal-install");
    await settle();
    expect(primary().textContent).toBe("Manage (v1.2.10)");
    expect(get("install-targets-result-row-cursor")?.textContent).toContain("permission denied");
    expect(get("install-targets-modal-done")).toBeTruthy();
    expect(onSkillsChanged).toHaveBeenCalledOnce();
    expect(onToast).toHaveBeenCalledWith("Install finished with 1 error: permission denied", "error");
    await click("install-targets-modal-done");
    await click("skill-detail-install-primary");
    expect(badge()?.textContent).toContain("Installed v1.2.10");
  });

  it("does not mark an entirely failed install as installed", async () => {
    failAll = true;
    await mount();
    await click("skill-detail-install-primary");
    await click("install-targets-modal-install");
    await settle();
    expect(primary().textContent).toBe("Install");
    expect(onSkillsChanged).not.toHaveBeenCalled();
    expect(get("install-targets-result-row-claude-code")?.textContent).toContain("disk full");
  });

  it.each([
    { isBlocked: true, blockReason: "Blocked by moderation" },
    { skillSlug: "example;touch /outside" },
  ])("keeps blocked or unsafe metadata outside management: %j", async (override) => {
    scopes.project = installed();
    metadata = { ...metadata, ...override };
    await mount();
    expect(primary()).toBeNull();
    expect(get("install-targets-modal")).toBeNull();
    expect(posts).toEqual([]);
  });

  it.each([true, false])("clipboard denial falls back safely (copy success: %s)", async (success) => {
    scopes.project = installed();
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    const descriptor = Object.getOwnPropertyDescriptor(document, "execCommand");
    const copy = vi.fn(() => success);
    Object.defineProperty(document, "execCommand", { configurable: true, value: copy });
    try {
      await mount();
      await click("skill-detail-copy-npm");
      expect(copy).toHaveBeenCalledWith("copy");
      expect(document.querySelector("textarea")).toBeNull();
      expect(onToast).toHaveBeenCalledWith(
        success ? `Run npx vskill@latest install ${skill} --scope project in your terminal`
          : "Copy failed — please copy the command manually.",
        success ? "success" : "error",
      );
      // A copy failure cannot block or silently invoke installed management.
      expect(primary().textContent).toContain("Manage");
      expect(get("install-targets-modal")).toBeNull();
      expect(posts).toEqual([]);
    } finally {
      if (descriptor) Object.defineProperty(document, "execCommand", descriptor);
      else Reflect.deleteProperty(document, "execCommand");
    }
  });

  it("keeps focus inside the detail and yields Escape to its management modal", async () => {
    scopes.project = installed();
    await mount();
    await settle();
    const back = get("skill-detail-back") ?? host.querySelector<HTMLButtonElement>("button")!;
    const last = get("skill-detail-copy-alternative")!;
    await act(async () => {
      last.focus();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", cancelable: true }));
    });
    expect(document.activeElement).toBe(back);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, cancelable: true })));
    expect(document.activeElement).toBe(last);
    const reopenPalette = vi.fn();
    window.addEventListener("openFindSkills", reopenPalette);
    try {
      await click("skill-detail-install-primary");
      await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      expect(reopenPalette).not.toHaveBeenCalled();
      expect(get("install-targets-modal")).toBeNull();
      expect(primary().textContent).toContain("Manage");
    } finally {
      window.removeEventListener("openFindSkills", reopenPalette);
    }
  });
});
