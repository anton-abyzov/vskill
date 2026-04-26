// @vitest-environment jsdom
// 0772 US-004 — handleCreate recovers from a 409 by treating it as a
// successful navigation to the existing skill (no red error banner).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiError } from "../../api";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Stub the api module before the hook imports it. Mocks must be created via
// vi.hoisted so they are accessible inside the hoisted vi.mock factory.
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

const { createSkillMock } = mocks;

vi.mock("../../ConfigContext", () => ({
  useConfig: () => ({ config: { providers: [] } }),
}));

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
  creating: boolean;
  error: string | null;
  info: string | null;
}

async function renderHook(onCreated: (p: string, s: string) => void): Promise<{
  getHandle: () => HookHandle;
  flush: () => Promise<void>;
}> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { useCreateSkill } = await import("../useCreateSkill");

  const ref: { current: HookHandle | null } = { current: null };
  const Harness: React.FC = () => {
    const r = useCreateSkill({ onCreated, forceLayout: 3 });
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

describe("useCreateSkill — 409 recovery (0772 US-004)", () => {
  beforeEach(() => {
    createSkillMock.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it("AC-US4-02: 409 with skill-already-exists treats as success and calls onCreated", async () => {
    createSkillMock.mockRejectedValueOnce(
      new ApiError("Skill already exists at /tmp/foo/skills/hello-skill", 409, {
        code: "skill-already-exists",
        plugin: "",
        skill: "hello-skill",
        dir: "/tmp/foo/skills/hello-skill",
      }),
    );
    const onCreated = vi.fn();
    const { getHandle, flush } = await renderHook(onCreated);
    const h = getHandle();
    h.setName("hello-skill");
    h.setDescription("Says hello");
    h.setSelectedLayout(3);
    h.setVersionValid(true);
    await flush();

    await getHandle().handleCreate();
    await flush();

    const after = getHandle();
    expect(onCreated).toHaveBeenCalledWith("", "hello-skill");
    expect(after.error).toBeNull();
    expect(after.info).toMatch(/already existed/i);
  });

  it("AC-US4-02: 409 without structured code falls through to error path", async () => {
    createSkillMock.mockRejectedValueOnce(
      new ApiError("Skill already exists at /tmp/foo/skills/hello-skill", 409, undefined),
    );
    const onCreated = vi.fn();
    const { getHandle, flush } = await renderHook(onCreated);
    const h = getHandle();
    h.setName("hello-skill");
    h.setDescription("Says hello");
    h.setSelectedLayout(3);
    h.setVersionValid(true);
    await flush();

    await getHandle().handleCreate();
    await flush();

    const after = getHandle();
    expect(onCreated).not.toHaveBeenCalled();
    expect(after.error).toMatch(/already exists/i);
    expect(after.info).toBeNull();
  });

  it("non-409 errors still set error (no info)", async () => {
    createSkillMock.mockRejectedValueOnce(new Error("network down"));
    const onCreated = vi.fn();
    const { getHandle, flush } = await renderHook(onCreated);
    const h = getHandle();
    h.setName("hello-skill");
    h.setDescription("Says hello");
    h.setSelectedLayout(3);
    h.setVersionValid(true);
    await flush();

    await getHandle().handleCreate();
    await flush();

    const after = getHandle();
    expect(after.error).toBe("network down");
    expect(after.info).toBeNull();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
