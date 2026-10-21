// @vitest-environment jsdom
// 0734 T-008 / T-014: useCreateSkill calls detect-engines on mount, applies
// the engine default precedence, sends `version` in the create payload and
// blocks submit client-side when the version is not valid semver.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Detection {
  vskillSkillBuilder: boolean;
  anthropicSkillCreator: boolean;
  vskillVersion: string | null;
  anthropicPath: string | null;
}

const mocks = vi.hoisted(() => ({
  createSkillMock: vi.fn(),
  detectEnginesMock: vi.fn(),
  authoringMock: vi.fn(),
  saveDraftMock: vi.fn(async () => ({ dir: "/tmp/test-project/skills/native" })),
}));

vi.mock("../../api", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../../api");
  return {
    ...actual,
    api: {
      createSkill: mocks.createSkillMock,
      detectEngines: mocks.detectEnginesMock,
      getSkillAuthoringContext: mocks.authoringMock,
      getSkills: vi.fn(async () => []),
      getProjectLayout: vi.fn(async () => ({
        root: "/tmp/test-project",
        detectedLayouts: [
          { layout: 3 as const, label: "Standalone", pathTemplate: "skills/{name}/SKILL.md", existingPlugins: [] },
        ],
        suggestedLayout: 3 as const,
        existingSkills: [],
      })),
      saveDraft: mocks.saveDraftMock,
    },
  };
});

vi.mock("../../ConfigContext", () => ({
  useConfig: () => ({ config: { providers: [] } }),
}));

const { createSkillMock, detectEnginesMock } = mocks;

interface HookHandle {
  engineDetection: Detection | null;
  engine: string;
  setEngine: (s: "vskill" | "anthropic-skill-creator" | "none") => void;
  setAiPrompt: (s: string) => void;
  handleGenerate: () => Promise<void>;
  refreshEngineDetection: () => Promise<void>;
  setName: (s: string) => void;
  setDescription: (s: string) => void;
  setModel: (s: string) => void;
  setAllowedTools: (s: string) => void;
  setSelectedLayout: (l: 1 | 2 | 3) => void;
  version: string;
  setVersion: (s: string) => void;
  versionValid: boolean;
  setVersionValid: (b: boolean) => void;
  handleCreate: () => Promise<void> | void;
  error: string | null;
  authoringMode: string;
  versionsHref?: string;
  nativeSkillMd?: string;
}

async function flushAct(fn?: () => unknown): Promise<void> {
  const { act } = await import("react");
  await act(async () => {
    await fn?.();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mountHook(onCreated: (p: string, s: string) => void = vi.fn(), updateTarget?: {plugin: string; skill: string}): Promise<() => HookHandle> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { useCreateSkill } = await import("../useCreateSkill");

  const ref: { current: HookHandle | null } = { current: null };
  const Harness: React.FC = () => {
    ref.current = useCreateSkill({ onCreated, forceLayout: 3, updateTarget }) as unknown as HookHandle;
    return null;
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Harness));
    await Promise.resolve();
  });
  return () => ref.current!;
}

function detection(partial: Partial<Detection>): Detection {
  return { vskillSkillBuilder: false, anthropicSkillCreator: false, vskillVersion: null, anthropicPath: null, ...partial };
}

describe("useCreateSkill: detect-engines on mount (0734 T-008, AC-US2-02/03)", () => {
  beforeEach(() => {
    createSkillMock.mockReset();
    detectEnginesMock.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it("calls detectEngines once on mount; detection is null (loading) until it resolves", async () => {
    let resolve!: (d: Detection) => void;
    detectEnginesMock.mockReturnValueOnce(new Promise<Detection>((r) => { resolve = r; }));
    const get = await mountHook();
    await flushAct();

    expect(detectEnginesMock).toHaveBeenCalledTimes(1);
    expect(get().engineDetection).toBeNull();

    await flushAct(() => resolve(detection({ vskillSkillBuilder: true, vskillVersion: "0.1.0" })));
    expect(get().engineDetection).toEqual(detection({ vskillSkillBuilder: true, vskillVersion: "0.1.0" }));
  });

  it("defaults to vskill when both engines are installed", async () => {
    detectEnginesMock.mockResolvedValueOnce(detection({ vskillSkillBuilder: true, anthropicSkillCreator: true }));
    const get = await mountHook();
    await flushAct();
    expect(get().engine).toBe("vskill");
  });

  it("defaults to anthropic-skill-creator when only Anthropic is installed", async () => {
    detectEnginesMock.mockResolvedValueOnce(detection({ anthropicSkillCreator: true, anthropicPath: "/x/skill-creator" }));
    const get = await mountHook();
    await flushAct();
    expect(get().engine).toBe("anthropic-skill-creator");
  });

  it("defaults to none when neither engine is installed", async () => {
    detectEnginesMock.mockResolvedValueOnce(detection({}));
    const get = await mountHook();
    await flushAct();
    expect(get().engine).toBe("none");
  });

  it("fails soft to all-false detection when the request errors", async () => {
    detectEnginesMock.mockRejectedValueOnce(new Error("offline"));
    const get = await mountHook();
    await flushAct();
    expect(get().engineDetection).toEqual(detection({}));
  });
});

describe("useCreateSkill: version in create payload (0734 T-014, AC-US4-04/06)", () => {
  beforeEach(() => {
    createSkillMock.mockReset();
    detectEnginesMock.mockReset();
    detectEnginesMock.mockResolvedValue(detection({ vskillSkillBuilder: true }));
  });
  afterEach(() => vi.clearAllMocks());

  async function fillForm(get: () => HookHandle): Promise<void> {
    await flushAct(() => {
      get().setName("hello-skill");
      get().setDescription("Says hello");
      get().setSelectedLayout(3);
    });
  }

  it("prefills version 1.0.0 and sends it in the POST body", async () => {
    createSkillMock.mockResolvedValueOnce({ plugin: "", skill: "hello-skill" });
    const onCreated = vi.fn();
    const get = await mountHook(onCreated);
    await flushAct();
    expect(get().version).toBe("1.0.0");
    await fillForm(get);

    await flushAct(() => get().handleCreate());

    expect(createSkillMock).toHaveBeenCalledTimes(1);
    expect(createSkillMock.mock.calls[0][0]).toMatchObject({ name: "hello-skill", version: "1.0.0", engine: "vskill" });
    expect(onCreated).toHaveBeenCalledWith("", "hello-skill");
  });

  it("sends a user-edited version", async () => {
    createSkillMock.mockResolvedValueOnce({ plugin: "", skill: "hello-skill" });
    const get = await mountHook();
    await flushAct();
    await fillForm(get);
    await flushAct(() => {
      get().setVersion("2.3.4-beta.1");
      get().setVersionValid(true);
    });

    await flushAct(() => get().handleCreate());

    expect(createSkillMock.mock.calls[0][0]).toMatchObject({ version: "2.3.4-beta.1" });
  });

  it("blocks submit before the request fires when the version is invalid", async () => {
    const onCreated = vi.fn();
    const get = await mountHook(onCreated);
    await flushAct();
    await fillForm(get);
    await flushAct(() => {
      get().setVersion("not-semver");
      get().setVersionValid(false);
    });

    await flushAct(() => get().handleCreate());

    expect(createSkillMock).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    expect(get().error).toMatch(/semver/i);
  });
});


describe("0734 engine execution guards", () => {
  beforeEach(() => {
    createSkillMock.mockReset();
    detectEnginesMock.mockReset();
    detectEnginesMock.mockResolvedValue(detection({ vskillSkillBuilder: true, anthropicSkillCreator: true }));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ error: "fixture" }) })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("passes the selected engine to generation", async () => {
    const get = await mountHook();
    await flushAct();
    await flushAct(() => { get().setEngine("anthropic-skill-creator"); get().setAiPrompt("Write a skill"); });
    await flushAct(() => get().handleGenerate());
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).engine).toBe("anthropic-skill-creator");
  });
  it("carries native generation through its autosaved draft and final save", async () => {
    const nativeSkillMd = "---\nname: native\ndescription: Native\ncontext: fork\n---\nBody";
    const result = { name: "native", description: "Native", model: "", allowedTools: "Read", body: "Body", nativeSkillMd, engine: "anthropic-skill-creator", emittedTargets: ["claude-code"], evals: [] };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, body: new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(`event: done\ndata: ${JSON.stringify(result)}\n\n`)); controller.close();
    } }) })));
    createSkillMock.mockResolvedValue({ plugin: "fixture", skill: "native" });
    const get = await mountHook();
    await flushAct(() => { get().setEngine("anthropic-skill-creator"); get().setAiPrompt("Write native"); get().setVersion("2.0.0"); });
    await flushAct(() => get().handleGenerate());
    expect(get().nativeSkillMd).toBe(nativeSkillMd);
    expect(mocks.saveDraftMock).toHaveBeenCalledWith(expect.objectContaining({ engine: "anthropic-skill-creator", version: "2.0.0", nativeSkillMd }));
    await flushAct(() => get().handleCreate());
    expect(createSkillMock).toHaveBeenCalledWith(expect.objectContaining({ engine: "anthropic-skill-creator", nativeSkillMd, targetAgents: ["claude-code"] }));
  });
  it("none never starts generation", async () => {
    const get = await mountHook();
    await flushAct();
    await flushAct(() => { get().setEngine("none"); get().setAiPrompt("Write a skill"); });
    await flushAct(() => get().handleGenerate());
    expect(fetch).not.toHaveBeenCalled();
  });
  it("a missing preselected engine blocks both generation and submission", async () => {
    detectEnginesMock.mockResolvedValue(detection({ vskillSkillBuilder: true }));
    const get = await mountHook();
    await flushAct();
    await flushAct(() => { get().setEngine("anthropic-skill-creator"); get().setAiPrompt("Write a skill"); get().setName("test"); get().setDescription("test"); });
    await flushAct(() => get().handleGenerate());
    await flushAct(() => get().handleCreate());
    expect(fetch).not.toHaveBeenCalled();
    expect(createSkillMock).not.toHaveBeenCalled();
  });
  it("validates the value even if no VersionInput is mounted", async () => {
    const get = await mountHook();
    await flushAct();
    await flushAct(() => { get().setName("test"); get().setDescription("test"); get().setVersion("invalid"); });
    await flushAct(() => get().handleCreate());
    expect(createSkillMock).not.toHaveBeenCalled();
  });
  it("refresh never overwrites the user's explicit vskill preselection", async () => {
    const get = await mountHook();
    await flushAct();
    await flushAct(() => get().setEngine("vskill"));
    detectEnginesMock.mockResolvedValue(detection({ anthropicSkillCreator: true }));
    await flushAct(() => get().refreshEngineDetection());
    expect(get().engine).toBe("vskill");
  });
});


it("0734 loads the current version/engine in update mode and saves to the original skill", async () => {
  detectEnginesMock.mockResolvedValue(detection({ vskillSkillBuilder: true, anthropicSkillCreator: true }));
  mocks.authoringMock.mockResolvedValue({ name: "existing", plugin: "", layout: 3, description: "Existing", body: "Native body", version: "2.3.4-beta.1", engine: "anthropic-skill-creator", nativeSkillMd: "---\ncontext: fork\n---\nNative body", versionsHref: "https://verified-skill.com/skills/owner/repo/existing/versions" });
  createSkillMock.mockReset();
  createSkillMock.mockResolvedValue({ plugin: "fixture", skill: "existing" });
  const get = await mountHook(vi.fn(), { plugin: "fixture", skill: "existing" });
  await flushAct(); await flushAct();
  expect(get().authoringMode).toBe("update");
  expect(get().version).toBe("2.3.4-beta.1");
  expect(get().engine).toBe("anthropic-skill-creator");
  expect(get().versionsHref).toContain("owner/repo/existing/versions");
  await flushAct(() => get().setVersion("2.3.4"));
  await flushAct(() => get().handleCreate());
  expect(createSkillMock).toHaveBeenCalledWith(expect.objectContaining({ mode: "update", name: "existing", version: "2.3.4", engine: "anthropic-skill-creator", nativeSkillMd: expect.stringContaining("context: fork") }));
});

it("0734 sends explicit empty fields when an existing model and allowed tools are cleared", async () => {
  detectEnginesMock.mockResolvedValue(detection({ vskillSkillBuilder: true }));
  mocks.authoringMock.mockResolvedValue({ name: "existing", plugin: "", layout: 3, description: "Existing", body: "Body", model: "opus", allowedTools: "Read, Bash", version: "1.0.0", engine: "vskill", nativeSkillMd: "---\nmodel: opus\nallowed-tools: Read, Bash\ncontext: fork\n---\nBody" });
  createSkillMock.mockReset();
  createSkillMock.mockResolvedValue({ plugin: "fixture", skill: "existing" });
  const get = await mountHook(vi.fn(), { plugin: "fixture", skill: "existing" });
  await flushAct(); await flushAct();
  await flushAct(() => { get().setModel(""); get().setAllowedTools(""); });
  await flushAct(() => get().handleCreate());
  // Assert the JSON wire shape: undefined would disappear and mean preserve.
  expect(JSON.parse(JSON.stringify(createSkillMock.mock.calls[0][0]))).toMatchObject({
    mode: "update", model: "", allowedTools: "", nativeSkillMd: expect.stringContaining("context: fork"),
  });
});
