// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CreateSkillPage } from "../CreateSkillPage";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({
  create: vi.fn(), layout: vi.fn(), authoring: vi.fn(), detect: vi.fn(), draft: vi.fn(),
  refresh: vi.fn(), reveal: vi.fn(), config: { current: null as any },
}));
vi.mock("../../StudioContext", () => ({ useStudio: () => ({ refreshSkills: mocks.refresh, revealSkill: mocks.reveal }) }));
vi.mock("../../ConfigContext", () => ({ useConfig: () => ({ config: mocks.config.current }) }));
vi.mock("../../api", async () => ({ ...(await vi.importActual<any>("../../api")), api: {
  getProjectLayout: mocks.layout, getSkillAuthoringContext: mocks.authoring,
  detectEngines: mocks.detect, createSkill: mocks.create, saveDraft: mocks.draft,
} }));
const native = '---\nname: existing\ndescription: Existing\nmodel: opus\nallowed-tools:\n  - Read\n# retain permission note\n\n  - Bash\ncontext: fork\nmetadata:\n  engine: vskill\n  version: "1.0.0"\n  custom: retained\n---\nOriginal';
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); window.location.hash = "#/create";
  mocks.config.current = { providers: [{ id: "claude-cli", label: "Claude", available: true, models: [{id: "sonnet", label: "Sonnet"}, {id: "opus", label: "Opus"}] }], root: "/fixture", projectName: "fixture" };
  mocks.layout.mockResolvedValue({ root: "/fixture", detectedLayouts: [{layout: 3, label: "Root skills", existingPlugins: []}], suggestedLayout: 3, existingSkills: [] });
  mocks.detect.mockResolvedValue({vskillSkillBuilder: true, anthropicSkillCreator: true, vskillVersion: "1.0.0", anthropicPath: "/fixture/creator"});
  mocks.authoring.mockResolvedValue({name: "existing", description: "Existing", model: "opus", allowedTools: "Read, Bash", body: "Original", version: "1.0.0", engine: "vskill", layout: 3, plugin: "", nativeSkillMd: native});
  mocks.create.mockResolvedValue({plugin: "fixture", skill: "existing"});
  mocks.draft.mockResolvedValue({dir: "/fixture/skills/draft"});
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({agents: []}))));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function flush(fn?: () => unknown) { await act(async () => { await fn?.(); await new Promise((resolve) => setTimeout(resolve, 0)); }); }
async function mount() { await flush(() => root.render(<MemoryRouter><CreateSkillPage /></MemoryRouter>)); await flush(); }
function button(text: string) { const found = [...container.querySelectorAll("button")].find((el) => el.textContent?.trim() === text); if (!found) throw Error(`Missing ${text}`); return found; }
async function edit(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await flush(() => { Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", {bubbles: true})); });
}
function input(placeholder: string) { return container.querySelector(`[placeholder="${placeholder}"]`) as HTMLInputElement; }
function preview() { return container.querySelector("pre")!.textContent!; }
it("previews cleared native fields and preserves custom YAML through the update payload", async () => {
  window.location.hash = "#/create?mode=update&pluginName=fixture&skillName=existing";
  await mount();
  expect(preview()).toContain("model: opus");
  const model = [...container.querySelectorAll("select")].find((el) => el.value === "opus")!;
  await edit(model, "");
  await edit(input("Read, Write, Edit, Bash, Glob, Grep"), "");
  await edit(input("Brief description — used for auto-activation keywords"), "Edited description");
  expect(preview()).not.toMatch(/^(model|allowed-tools):/m);
  expect(preview()).not.toMatch(/^\s*- (Read|Bash)$/m);
  expect(preview()).toContain("# retain permission note");
  expect(preview()).toContain('description: "Edited description"');
  expect(preview()).toContain("context: fork");
  expect(preview()).toContain("custom: retained");
  await flush(() => button("Update Skill").click());
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({model: "", allowedTools: "", description: "Edited description", nativeSkillMd: native}));
});

it.each(["allowed-tools:\n    - Read\n    - Bash", "allowed-tools: [\nRead,\nBash\n]"])("preserves an untouched native field the lightweight reader cannot represent: %s", async (tools) => {
  const document = `---\nname: existing\ndescription: Existing\nmodel: opus\n${tools}\ncontext: fork\nmetadata:\n  version: 1.0.0\n  engine: vskill\n---\nOriginal`;
  mocks.authoring.mockResolvedValue({name: "existing", description: "Existing", model: "opus", allowedTools: "", body: "Original", version: "1.0.0", engine: "vskill", layout: 3, plugin: "", nativeSkillMd: document});
  window.location.hash = "#/create?mode=update&pluginName=fixture&skillName=existing";
  await mount(); await edit(input("Brief description — used for auto-activation keywords"), "Edited description");
  expect(preview()).toContain(tools);
  await flush(() => button("Update Skill").click());
  const payload = mocks.create.mock.calls[0][0];
  expect(payload.allowedTools).toBeUndefined(); expect(payload.model).toBeUndefined();
  expect(payload.nativeSkillMd).toBe(document);
});

function generated(result: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("/generate")
    ? new Response(`event: progress\ndata: {"phase":"generating-body","message":"Writing fixture"}\n\nevent: done\ndata: ${JSON.stringify({ name: "generated", description: "Generated fixture", body: "# Generated", model: "", allowedTools: "", evals: [], reasoning: "fixture", ...result })}\n\n`, {headers: {"Content-Type": "text/event-stream"}})
    : new Response(JSON.stringify({ agents: [] }))));
}
async function generate() {
  await edit(container.querySelector('textarea[placeholder^="e.g., A skill"]')!, "Write a fixture skill");
  await flush(() => button("Generate Skill").click()); await flush();
}
it("lets an author choose a new plugin, edit Markdown, preview it and submit", async () => {
  mocks.layout.mockResolvedValue({ root: "/fixture", detectedLayouts: [{layout: 1, label: "Direct plugins", existingPlugins: ["alpha"]}, {layout: 2, label: "Nested plugins", existingPlugins: ["beta"]}], suggestedLayout: 1, existingSkills: [] });
  await mount(); await flush(() => button("Manual").click());
  await edit(input("my-skill"), "manual");
  await edit(input("Brief description — used for auto-activation keywords"), "Manual fixture");
  await flush(() => button("Nested plugins").click());
  const plugin = [...container.querySelectorAll("select")].find((el) => el.value === "beta")!;
  await edit(plugin, "__new__"); await edit(input("my-plugin"), "new-category");
  await edit(container.querySelector('textarea[placeholder^="# /my-skill"]')!, "# Edited\n\n**Reviewed** body");
  await flush(() => button("Preview").click());
  expect(container.querySelector("strong")?.textContent).toBe("Reviewed");
  await flush(() => button("Write").click());
  await flush(() => button("Create Skill").click());
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({name: "manual", plugin: "new-category", layout: 2, body: "# Edited\n\n**Reviewed** body"}));
  expect(mocks.refresh).toHaveBeenCalled();
});
it("offers plugin placement after AI generation without changing an explicit standalone choice", async () => {
  mocks.layout.mockResolvedValue({ root: "/fixture", detectedLayouts: [{layout: 2, label: "Nested plugins", existingPlugins: ["beta"]}, {layout: 3, label: "Root skills", existingPlugins: []}], suggestedLayout: 3, existingSkills: [] });
  generated({}); await mount(); await generate();
  expect(container.textContent).toContain("Plugins detected");
  await flush(() => button("Use plugin").click());
  expect(container.textContent).toContain("beta/skills/generated/SKILL.md");
  expect(mocks.draft).toHaveBeenCalled();
});
it.each([{plugin: "beta", layout: 2}, {plugin: "new-category"}, {plugin: "beta"}])("previews and submits a generated plugin suggestion %j", async (suggestedPlugin) => {
  mocks.layout.mockResolvedValue({ root: "/fixture", detectedLayouts: [{layout: 2, label: "Nested plugins", existingPlugins: ["beta"]}, {layout: 3, label: "Root skills", existingPlugins: []}], suggestedLayout: 3, existingSkills: [] });
  generated({ suggestedPlugin }); await mount(); await generate();
  await flush(() => button("Create Skill").click());
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({name: "generated", plugin: suggestedPlugin.plugin}));
});
it("keeps URL-selected standalone placement locked during generation", async () => {
  window.location.hash = "#/create?mode=standalone&description=Fixture";
  generated({ suggestedPlugin: {plugin: "beta", layout: 2} }); await mount(); await generate();
  expect(container.textContent).toContain("Standalone skill");
  expect(container.textContent).not.toContain("Plugins detected");
  await flush(() => button("Create Skill").click());
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({layout: 3, plugin: ""}));
});
it.each(['API usage limits reached; regain access on tomorrow UTC"', 'Usage limit reached, reset next month'])('renders actionable quota failure and dismisses it: %s', async (message) => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("/generate")
    ? new Response(`event: error\ndata: ${JSON.stringify({message})}\n\n`)
    : new Response(JSON.stringify({agents: []}))));
  await mount(); await generate();
  expect(container.textContent).toContain("Your Claude Code session quota is exhausted");
  expect(container.querySelector('a[href="https://claude.com/settings/usage"]')).not.toBeNull();
  await flush(() => button("Dismiss").click());
  expect(container.textContent).not.toContain("Your Claude Code session quota is exhausted");
});
it("shows a save error without navigating away from reviewed fields", async () => {
  window.location.hash = "#/create?mode=update&pluginName=fixture&skillName=existing";
  mocks.create.mockRejectedValue(new Error("Fixture disk full")); await mount();
  await flush(() => button("Update Skill").click());
  expect(container.textContent).toContain("Fixture disk full");
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(input("my-skill").value).toBe("existing");
});
it("updates the selected provider and model before generation", async () => {
  mocks.config.current.providers.push(...["anthropic", "openrouter", "ollama", "lm-studio"].map((id) => ({id, label: id, available: true, models: [{id: "local", label: "Local"}, {id: "alternate", label: "Alternate"}]})));
  generated({}); await mount();
  const provider = [...container.querySelectorAll("select")].find((el) => el.value === "claude-cli")!;
  await edit(provider, "ollama");
  expect(container.textContent).toContain("Zero cost");
  const model = [...container.querySelectorAll("select")].find((el) => el.value === "local")!;
  await edit(model, "alternate"); await generate();
  const request = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes("/generate"))!;
  expect(JSON.parse(request[1]!.body as string)).toMatchObject({provider: "ollama", model: "alternate", engine: "vskill"});
});
it("completes engine consent, inline feedback, detection refresh and selection on the actual page", async () => {
  mocks.detect.mockResolvedValueOnce({vskillSkillBuilder: false, anthropicSkillCreator: false}).mockResolvedValue({vskillSkillBuilder: true, anthropicSkillCreator: false});
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    requests.push(url);
    if (url === "/api/studio/install-engine") return new Response(JSON.stringify({jobId: "fixture"}), {status: 202});
    if (url.endsWith("/fixture/stream")) return new Response('event: progress\ndata: {"stream":"stdout","line":"Fixture complete"}\n\nevent: done\ndata: {"success":true,"exitCode":0,"stderr":""}\n\n');
    return new Response(JSON.stringify({agents: []}));
  }));
  await mount();
  await flush(() => (container.querySelector('[data-testid="install-vskill"]') as HTMLElement).click());
  expect(requests).not.toContain("/api/studio/install-engine");
  expect(container.textContent).toContain("vskill install anton-abyzov/vskill/skill-builder");
  await flush(() => (container.querySelector('[data-testid="install-run"]') as HTMLElement).click()); await flush();
  expect(mocks.detect).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[data-testid="engine-selector-vskill"]')?.getAttribute("aria-selected")).toBe("true");
  expect(container.querySelector('[data-testid="engine-install-status-vskill"]')?.textContent).toContain("Installed");
  await flush(() => button("Done").click());
  expect(container.querySelector('[data-testid="install-engine-modal"]')).toBeNull();
});
it("shows generation progress and cancels only its active request", async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let signal!: AbortSignal;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (!url.includes("/generate")) return new Response(JSON.stringify({agents: []}));
    signal = init!.signal!;
    return new Response(new ReadableStream({start(controller) {stream = controller; signal.addEventListener("abort", () => controller.error(new DOMException("Cancelled", "AbortError")));}}));
  }));
  await mount(); await generate();
  await flush(() => stream.enqueue(new TextEncoder().encode('event: progress\ndata: {"phase":"generating-body","message":"Writing fixture"}\n\n')));
  expect(container.textContent).toContain("Writing fixture");
  await flush(() => button("Cancel Generation").click());
  expect(signal.aborted).toBe(true);
  expect(button("Generate Skill").disabled).toBe(false);
  expect(mocks.draft).not.toHaveBeenCalled();
});
it("switches a non-Claude provider back to Claude when the native engine is selected", async () => {
  mocks.config.current.providers.unshift({id: "ollama", label: "Ollama", available: true, models: [{id: "local", label: "Local"}]});
  await mount();
  const provider = [...container.querySelectorAll("select")].find((el) => el.value === "claude-cli")!;
  await edit(provider, "ollama");
  await flush(() => (container.querySelector('[data-testid="engine-selector-anthropic-skill-creator"]') as HTMLElement).click());
  expect(provider.value).toBe("claude-cli"); expect(provider.disabled).toBe(true);
  expect(preview()).toContain("engine: anthropic-skill-creator");
});
