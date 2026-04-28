// @vitest-environment jsdom
// 0786 US-001 — handleCreate MUST await flushPendingForSkillName BEFORE
// invoking api.createSkill. Without this, the 10s Undo buffer keeps the
// previous skill folder on disk and the server's existsSync check returns
// 409 skill-already-exists. Asserts strict call ordering with a deferred
// promise so the bug cannot be silently regressed by a refactor that drops
// the await or reorders the calls.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  createSkillMock: vi.fn(),
  getSkillsMock: vi.fn(async () => []),
  getProjectLayoutMock: vi.fn(async () => ({
    root: "/tmp/test-project",
    detectedLayouts: [
      { layout: 3 as const, label: "Standalone", pathTemplate: "skills/{name}/SKILL.md", existingPlugins: [] },
    ],
    suggestedLayout: 3 as const,
    existingSkills: [],
  })),
}));

vi.mock("../../api", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../../api");
  return {
    ...actual,
    api: {
      createSkill: mocks.createSkillMock,
      getSkills: mocks.getSkillsMock,
      getProjectLayout: mocks.getProjectLayoutMock,
      detectEngines: vi.fn(async () => ({
        vskillSkillBuilder: false,
        anthropicSkillCreator: false,
        vskillVersion: null,
      })),
      saveDraft: vi.fn(),
    },
  };
});

vi.mock("../../ConfigContext", () => ({
  useConfig: () => ({ config: { providers: [] } }),
}));

const { createSkillMock } = mocks;

interface HookHandle {
  name: string;
  setName: (s: string) => void;
  description: string;
  setDescription: (s: string) => void;
  selectedLayout: 1 | 2 | 3;
  setSelectedLayout: (l: 1 | 2 | 3) => void;
  versionValid: boolean;
  setVersionValid: (b: boolean) => void;
  handleCreate: () => Promise<void> | void;
}

async function renderHookWithFlush(
  onCreated: (p: string, s: string) => void,
  flushPendingForSkillName: (name: string) => Promise<void>,
): Promise<{ getHandle: () => HookHandle; flush: () => Promise<void> }> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { useCreateSkill } = await import("../useCreateSkill");

  const ref: { current: HookHandle | null } = { current: null };
  const Harness: React.FC = () => {
    const r = useCreateSkill({ onCreated, forceLayout: 3, flushPendingForSkillName });
    ref.current = r as unknown as HookHandle;
    return null;
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(Harness));
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return {
    getHandle: () => ref.current!,
    flush: async () => {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    },
  };
}

describe("useCreateSkill — flush ordering (0786 AC-US1-01, AC-US1-04)", () => {
  beforeEach(() => {
    createSkillMock.mockReset();
    createSkillMock.mockResolvedValue({ plugin: "", skill: "x" });
  });
  afterEach(() => vi.clearAllMocks());

  it("awaits flushPendingForSkillName BEFORE api.createSkill is invoked", async () => {
    const callOrder: string[] = [];

    // Deferred promise — flushPendingForSkillName resolves only when we say so.
    let resolveFlush!: () => void;
    const flushDeferred = new Promise<void>((resolve) => {
      resolveFlush = resolve;
    });
    const flushPendingForSkillName = vi.fn(async (skillName: string) => {
      callOrder.push(`flush:${skillName}`);
      await flushDeferred;
      callOrder.push(`flush:${skillName}:resolved`);
    });

    createSkillMock.mockImplementation(async () => {
      callOrder.push("api.createSkill");
      return { plugin: "", skill: "hello-skill" };
    });

    const { getHandle, flush } = await renderHookWithFlush(
      vi.fn(),
      flushPendingForSkillName,
    );
    const h = getHandle();
    h.setName("hello-skill");
    h.setDescription("Says hello");
    h.setSelectedLayout(3);
    h.setVersionValid(true);
    await flush();

    // Kick off handleCreate but DO NOT resolve flush yet.
    const createPromise = getHandle().handleCreate();
    await flush();

    // At this point, flush has been called with the kebab name but
    // api.createSkill MUST NOT have been invoked yet — the await is
    // blocking it.
    expect(flushPendingForSkillName).toHaveBeenCalledTimes(1);
    expect(flushPendingForSkillName).toHaveBeenCalledWith("hello-skill");
    expect(createSkillMock).not.toHaveBeenCalled();
    expect(callOrder).toEqual(["flush:hello-skill"]);

    // Resolve flush; api.createSkill should now run.
    resolveFlush();
    await createPromise;
    await flush();

    expect(createSkillMock).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual([
      "flush:hello-skill",
      "flush:hello-skill:resolved",
      "api.createSkill",
    ]);
  });

  it("does not call api.createSkill if flushPendingForSkillName rejects", async () => {
    const flushPendingForSkillName = vi.fn(async () => {
      throw new Error("flush failed");
    });

    const { getHandle, flush } = await renderHookWithFlush(
      vi.fn(),
      flushPendingForSkillName,
    );
    const h = getHandle();
    h.setName("hello-skill");
    h.setDescription("Says hello");
    h.setSelectedLayout(3);
    h.setVersionValid(true);
    await flush();

    await getHandle().handleCreate();
    await flush();

    // api.createSkill must NOT run when flush throws — handleCreate's try
    // block catches the flush rejection and surfaces it as setError; the
    // create call never gets a chance.
    expect(createSkillMock).not.toHaveBeenCalled();
  });

  it("works without flushPendingForSkillName (legacy / undefined option)", async () => {
    const { getHandle, flush } = await renderHookWithFlush(
      vi.fn(),
      undefined as unknown as (n: string) => Promise<void>,
    );
    const h = getHandle();
    h.setName("hello-skill");
    h.setDescription("Says hello");
    h.setSelectedLayout(3);
    h.setVersionValid(true);
    await flush();

    await getHandle().handleCreate();
    await flush();

    expect(createSkillMock).toHaveBeenCalledTimes(1);
  });
});
