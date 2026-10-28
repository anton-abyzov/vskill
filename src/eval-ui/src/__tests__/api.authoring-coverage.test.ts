import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../api";
import type { CreateSkillRequest, EvalsFile, SaveDraftRequest, TransferEvent } from "../types";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new Error("Unexpected request in API contract test"));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function respond(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(Response.json(body, { status }));
}

function expectRequest(url: string, method: string, body?: unknown) {
  const [actualUrl, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]!;
  expect(actualUrl).toBe(url);
  expect(init?.method ?? "GET").toBe(method);
  if (body !== undefined) {
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual(body);
  } else {
    expect(init?.body).toBeUndefined();
  }
}

const authored: CreateSkillRequest = {
  name: "release-notes", plugin: "tools", layout: 2,
  description: "Prepare release notes", body: "# Release notes\nPreserve the user's wording.\n",
  version: "2.4.0-beta.1", engine: "anthropic-skill-creator",
  nativeSkillMd: "---\nname: release-notes\ncustom: preserved\n---\nNative text\n",
  targetAgents: ["claude-code", "codex"], mode: "update",
  draftDir: "/fixture/drafts/release-notes",
};

describe("authoring API request and refusal contracts", () => {
  it("preserves native content, explicit version, update mode and targets when saving", async () => {
    const saved = { ok: true, plugin: "tools", skill: "release-notes", dir: "/fixture/skills/release-notes", skillMdPath: "/fixture/skills/release-notes/SKILL.md", version: authored.version, engine: authored.engine, emittedTargets: authored.targetAgents };
    respond(saved);
    expect(await api.createSkill(authored)).toEqual(saved);
    expectRequest("/api/skills/create", "POST", authored);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves draft generation metadata without substituting an engine or version", async () => {
    const draft: SaveDraftRequest = {
      ...authored, engine: "none",
      aiMeta: { prompt: "Create release notes", provider: "fixture", model: "local", reasoning: "Retain native metadata" },
    };
    const saved = { ok: true, plugin: "tools", skill: "release-notes", dir: authored.draftDir, skillMdPath: "/fixture/drafts/release-notes/SKILL.md", files: ["SKILL.md"] };
    respond(saved);
    expect(await api.saveDraft(draft)).toEqual(saved);
    expectRequest("/api/skills/save-draft", "POST", draft);
  });

  it("retains conflict details needed to offer updating the existing skill", async () => {
    const conflict = { error: "Skill already exists", code: "skill-already-exists", plugin: "tools", skill: "release-notes", currentVersion: "2.3.0" };
    respond(conflict, 409);
    await expect(api.createSkill(authored)).rejects.toMatchObject({ name: "ApiError", status: 409, message: conflict.error, details: conflict });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces validation details without silently falling back to another engine", async () => {
    const refusal = { error: "Native engine unavailable", code: "engine-unavailable", engine: "anthropic-skill-creator" };
    respond(refusal, 422);
    await expect(api.createSkill(authored)).rejects.toMatchObject({ status: 422, details: refusal });
    expectRequest("/api/skills/create", "POST", authored);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: "HTML gateway refusal", response: () => new Response("<html>unavailable</html>", { status: 503, statusText: "Service Unavailable" }), message: "Service Unavailable" },
    { label: "empty JSON refusal", response: () => Response.json(null, { status: 403 }), message: "HTTP 403" },
  ])("reports $label as a typed error", async ({ response, message }) => {
    fetchMock.mockResolvedValueOnce(response());
    await expect(api.saveDraft({ ...authored, aiMeta: { prompt: "Draft", provider: "fixture", model: "local", reasoning: "Retain content" } })).rejects.toMatchObject({ name: "ApiError", message });
  });

  it("propagates network failure and malformed success instead of inventing a saved skill", async () => {
    const offline = new TypeError("offline");
    fetchMock.mockRejectedValueOnce(offline);
    await expect(api.createSkill(authored)).rejects.toBe(offline);
    fetchMock.mockResolvedValueOnce(new Response("not-json", { status: 200 }));
    await expect(api.createSkill(authored)).rejects.toBeInstanceOf(SyntaxError);
  });

  it("encodes an existing skill identity without changing its authoring context", async () => {
    const context = { name: "release notes", engine: "none", version: "4.0.0", skillMd: "exact native bytes\n" };
    respond(context);
    expect(await api.getSkillAuthoringContext("team/tools", "release notes")).toEqual(context);
    expectRequest("/api/skills/team%2Ftools/release%20notes/authoring", "GET");
  });
});

describe("editor and authoring support endpoints", () => {
  const evals: EvalsFile = { skill_name: "release-notes", evals: [] };
  const reads = [
    { name: "configuration", call: () => api.getConfig(), url: "/api/config", reply: { provider: null, model: "", providers: [], projectName: "fixture", root: "/fixture" } },
    { name: "available engines", call: () => api.detectEngines(), url: "/api/studio/detect-engines", reply: { vskillSkillBuilder: true, anthropicSkillCreator: false, vskillVersion: "1.2.11", anthropicPath: null } },
    { name: "native creator status", call: () => api.getSkillCreatorStatus(), url: "/api/skill-creator-status", reply: { installed: false, installCommand: "vskill install fixture/creator" } },
    { name: "project layout", call: () => api.getProjectLayout(), url: "/api/project-layout", reply: { root: "/fixture", detectedLayouts: [], suggestedLayout: 2, existingSkills: [] } },
    { name: "GitHub readiness", call: () => api.getProjectGitHubStatus(), url: "/api/project/github-status", reply: { hasGit: true, githubOrigin: null, status: "non-github" } },
    { name: "agent list", call: () => api.getAgents(), url: "/api/agents", reply: { agents: [] } },
    { name: "skill content", call: () => api.getSkillDetail("p", "s"), url: "/api/skills/p/s", reply: { plugin: "p", skill: "s", skillContent: "# Exact text\n" } },
    { name: "dependencies", call: () => api.getDependencies("p", "s"), url: "/api/skills/p/s/dependencies", reply: { dependencies: [] } },
    { name: "evaluation stats", call: () => api.getStats("p", "s"), url: "/api/skills/p/s/stats", reply: { runs: 0 } },
    { name: "asset list", call: () => api.getSkillFiles("p", "s"), url: "/api/skills/p/s/files", reply: { files: [{ path: "references/checks.md", size: 18, type: "file" }] } },
    { name: "asset with query punctuation", call: () => api.getSkillFile("p", "s", "references/a & b?.md"), url: "/api/skills/p/s/file?path=references%2Fa%20%26%20b%3F.md", reply: { path: "references/a & b?.md", content: "unchanged\n", size: 10 } },
    { name: "activation history", call: () => api.getActivationHistoryEnvelope("p", "s"), url: "/api/skills/p/s/activation-history", reply: { runs: [], count: 0 } },
    { name: "leaderboard", call: () => api.getLeaderboard("p", "s"), url: "/api/skills/p/s/leaderboard", reply: { entries: [] } },
    { name: "leaderboard timestamp", call: () => api.getLeaderboardEntry("p", "s", "2026-10-21T12:00:00+02:00"), url: "/api/skills/p/s/leaderboard/2026-10-21T12%3A00%3A00%2B02%3A00", reply: { timestamp: "2026-10-21T12:00:00+02:00", results: [] } },
    { name: "history timestamp", call: () => api.getHistoryEntry("p", "s", "a/b"), url: "/api/skills/p/s/history/a%2Fb", reply: { timestamp: "a/b", results: [] } },
    { name: "credential status", call: () => api.getCredentials("p", "s"), url: "/api/credentials/p/s", reply: { credentials: [{ name: "FIXTURE_TOKEN", configured: false }] } },
    { name: "masked parameters", call: () => api.getParams("p", "s"), url: "/api/credentials/p/s/params", reply: { params: [{ name: "fixture", maskedValue: "***", status: "set" }] } },
    { name: "model catalog", call: () => api.searchModels(), url: "/api/openrouter/models", reply: { models: [] } },
  ];

  it.each(reads)("reads $name without issuing a mutation", async ({ call, url, reply }) => {
    respond(reply);
    expect(await call()).toEqual(reply);
    expectRequest(url, "GET");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  const writes = [
    { name: "provider selection", call: () => api.setConfig("ollama", "local-model"), url: "/api/config", method: "POST", body: { provider: "ollama", model: "local-model" } },
    { name: "provider default model", call: () => api.setConfig("ollama"), url: "/api/config", method: "POST", body: { provider: "ollama" } },
    { name: "prompt generation", call: () => api.generateSkill({ prompt: "Preserve quotation: \"A&B\"\n", provider: "ollama", model: "local-model" }), url: "/api/skills/generate", method: "POST", body: { prompt: "Preserve quotation: \"A&B\"\n", provider: "ollama", model: "local-model" } },
    { name: "eval save", call: () => api.saveEvals("p", "s", evals), url: "/api/skills/p/s/evals", method: "PUT", body: evals },
    { name: "eval generation", call: () => api.generateEvals("p", "s"), url: "/api/skills/p/s/generate-evals", method: "POST", body: undefined },
    { name: "asset save", call: () => api.saveSkillFile("p", "s", "references/note.md", "# Notes\n\nKeep this.\n"), url: "/api/skills/p/s/file", method: "PUT", body: { path: "references/note.md", content: "# Notes\n\nKeep this.\n" } },
    { name: "evaluate improvement", call: () => api.improveSkill("p", "s", { eval_id: 7, notes: "Keep examples" }), url: "/api/skills/p/s/improve", method: "POST", body: { eval_id: 7, notes: "Keep examples" } },
    { name: "instruction edit", call: () => api.instructEdit("p", "s", { instruction: "Shorten", content: "original\n", evals }), url: "/api/skills/p/s/improve", method: "POST", body: { mode: "instruct", instruction: "Shorten", content: "original\n", evals } },
    { name: "apply reviewed improvement", call: () => api.applyImprovement("p", "s", "approved\n"), url: "/api/skills/p/s/apply-improvement", method: "POST", body: { content: "approved\n" } },
    { name: "editor directory", call: () => api.revealInEditor("p", "s"), url: "/api/skills/reveal-in-editor", method: "POST", body: { plugin: "p", skill: "s" } },
    { name: "editor file", call: () => api.revealInEditor("p", "s", "references/a.md"), url: "/api/skills/reveal-in-editor", method: "POST", body: { plugin: "p", skill: "s", file: "references/a.md" } },
    { name: "plugin conversion", call: () => api.convertToPlugin({ anchorSkillDir: "/fixture/skills/s", pluginName: "p", description: "Tools" }), url: "/api/authoring/convert-to-plugin", method: "POST", body: { anchorSkillDir: "/fixture/skills/s", pluginName: "p", description: "Tools" } },
    { name: "history deletion", call: () => api.deleteHistoryEntry("p", "s", "a/b"), url: "/api/skills/p/s/history/a%2Fb", method: "DELETE", body: undefined },
    { name: "source skill deletion", call: () => api.deleteSkill("p", "s"), url: "/api/skills/p/s", method: "DELETE", body: undefined },
    { name: "installed skill removal", call: () => api.uninstallSkill("p", "s"), url: "/api/skills/p/s/uninstall", method: "POST", body: undefined },
    { name: "credential write", call: () => api.setCredential("p", "s", "FIXTURE_TOKEN", "fake-local-value"), url: "/api/credentials/p/s", method: "PUT", body: { name: "FIXTURE_TOKEN", value: "fake-local-value" } },
  ];

  it.each(writes)("sends $name with its explicit method and body", async ({ call, url, method, body }) => {
    respond({ ok: true });
    expect(await call()).toEqual({ ok: true });
    expectRequest(url, method, body);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, "api/key & name"])("reveals only the requested parameter selection (%s)", async key => {
    respond({ params: [{ name: key ?? "all", value: "fake-local-value", maskedValue: "***", status: "set" }] });
    const result = await api.getParamsRevealed("p", "s", key);
    expect(result.params[0].value).toBe("fake-local-value");
    expectRequest(`/api/credentials/p/s/params?reveal=true${key ? "&key=api%2Fkey%20%26%20name" : ""}`, "GET");
  });
});

describe("evaluation and version response envelopes", () => {
  it.each([
    { wire: { exists: false, evals: [] }, expected: { skill_name: "s", evals: [] } },
    { wire: { exists: true, skill_name: "named", evals: [], description: "retained" }, expected: { skill_name: "named", evals: [], description: "retained" } },
    { wire: { skill_name: "legacy", evals: [] }, expected: { skill_name: "legacy", evals: [] } },
  ])("normalizes an evaluation response without discarding its fields", async ({ wire, expected }) => {
    respond(wire);
    expect(await api.getEvals("p", "s")).toEqual(expected);
  });

  it("keeps exists metadata available and propagates malformed-evals details", async () => {
    respond({ exists: false, evals: [] });
    expect(await api.getEvalsEnvelope("p", "s")).toEqual({ exists: false, evals: [] });
    respond({ error: "Invalid evals", errors: ["evals[0].prompt is required"] }, 422);
    await expect(api.getEvals("p", "s")).rejects.toMatchObject({ status: 422, details: { errors: ["evals[0].prompt is required"] } });
  });

  it("distinguishes no benchmark from benchmark retrieval failure", async () => {
    respond(null);
    expect(await api.getLatestBenchmark("p", "s")).toBeNull();
    respond({ error: "Benchmark storage unavailable" }, 503);
    await expect(api.getLatestBenchmark("p", "s")).rejects.toMatchObject({ status: 503, message: "Benchmark storage unavailable" });
    fetchMock.mockResolvedValueOnce(new Response("bad gateway", { status: 502 }));
    await expect(api.getLatestBenchmark("p", "s")).rejects.toMatchObject({ status: 502, message: "HTTP 502" });
  });

  it("unwraps version history while preserving provider metadata through the envelope API", async () => {
    const versions = [{ version: "2.0.0", createdAt: "2026-10-21T12:00:00Z" }];
    const envelope = { versions, count: 1, source: "platform", provider: "github", trackedForUpdates: true };
    respond(envelope);
    expect(await api.getSkillVersions("p", "s")).toEqual(versions);
    respond(envelope);
    expect(await api.getSkillVersionsEnvelope("p", "s")).toEqual(envelope);
    respond({ count: 0, source: "none" });
    expect(await api.getSkillVersions("p", "s")).toEqual([]);
  });
});

function streamResponse(text: string, chunkSize = 7, status = 200) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
      controller.close();
    },
  }), { status, headers: { "Content-Type": "text/event-stream" } });
}

function frame(event: string, payload: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

describe("scope transfer streamed outcomes", () => {
  it("delivers ordered progress across split UTF-8 chunks and returns the final destination", async () => {
    const events: TransferEvent[] = [];
    const done = { opId: "op-1", destPath: "/fixture/résumé" };
    fetchMock.mockResolvedValueOnce(streamResponse(
      ": heartbeat\n\n" + frame("started", { opId: "op-1", skillId: "p/s", fromScope: "installed", toScope: "own", sourcePath: "/fixture/source", destPath: done.destPath }) +
      frame("copied", { filesWritten: 3 }) + frame("deleted", { filesDeleted: 1 }) + frame("indexed", {}) + frame("done", done), 1,
    ));
    const signal = new AbortController().signal;
    expect(await api.promoteSkill("p", "s", { overwrite: true, signal, onEvent: e => events.push(e) })).toEqual({ type: "done", ...done });
    expect(events.map(e => e.type)).toEqual(["started", "copied", "deleted", "indexed", "done"]);
    expectRequest("/api/skills/p/s/promote?overwrite=true", "POST");
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(signal);
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("accept")).toBe("text/event-stream");
  });

  it("ignores unrelated events and malformed frames without losing the next valid event", async () => {
    const events: TransferEvent[] = [];
    fetchMock.mockResolvedValueOnce(streamResponse(frame("heartbeat", {}) + "event: copied\ndata: {broken}\n\n" + frame("done", { opId: "op-2", destPath: "/fixture/installed" })));
    expect(await api.testInstallSkill("p", "s", { dest: "global", overwrite: true, onEvent: e => events.push(e) })).toMatchObject({ type: "done", opId: "op-2" });
    expect(events).toHaveLength(1);
    expectRequest("/api/skills/p/s/test-install?dest=global&overwrite=true", "POST");
  });

  it.each([
    { name: "default promotion", call: () => api.promoteSkill("p", "s"), url: "/api/skills/p/s/promote" },
    { name: "project install", call: () => api.testInstallSkill("p", "s", { dest: "installed" }), url: "/api/skills/p/s/test-install" },
    { name: "revert", call: () => api.revertSkill("p", "s"), url: "/api/skills/p/s/revert" },
  ])("uses the correct $name destination", async ({ call, url }) => {
    fetchMock.mockResolvedValueOnce(streamResponse(frame("done", { opId: "op-3", destPath: "/fixture/result" })));
    expect(await call()).toMatchObject({ type: "done", destPath: "/fixture/result" });
    expectRequest(url, "POST");
  });

  it("rejects an error event even if a done frame also arrived", async () => {
    const onEvent = vi.fn();
    fetchMock.mockResolvedValueOnce(streamResponse(frame("error", { code: "copy-refused", message: "Destination is read-only" }) + frame("done", { opId: "op-4", destPath: "/fixture/result" })));
    await expect(api.revertSkill("p", "s", { onEvent })).rejects.toMatchObject({ name: "ApiError", status: 500, code: "copy-refused", message: "Destination is read-only" });
    expect(onEvent).toHaveBeenCalledWith({ type: "error", code: "copy-refused", message: "Destination is read-only" });
  });

  it("does not report a truncated stream as a completed transfer", async () => {
    fetchMock.mockResolvedValueOnce(streamResponse(frame("copied", { filesWritten: 1 })));
    await expect(api.promoteSkill("p", "s")).rejects.toMatchObject({ status: 500, message: "Transfer stream ended without 'done' event" });
  });

  it("forwards structured HTTP refusal codes without consuming them as SSE", async () => {
    respond({ error: "Destination already exists", code: "destination-exists" }, 409);
    await expect(api.testInstallSkill("p", "s")).rejects.toMatchObject({ status: 409, code: "destination-exists", message: "Destination already exists" });
    fetchMock.mockResolvedValueOnce(new Response("bad gateway", { status: 502 }));
    await expect(api.revertSkill("p", "s")).rejects.toMatchObject({ status: 502, message: "HTTP 502" });
  });

  it("rejects missing stream bodies and preserves cancellation", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await expect(api.promoteSkill("p", "s")).rejects.toBeInstanceOf(ApiError);
    const controller = new AbortController();
    controller.abort();
    const aborted = new DOMException("Cancelled", "AbortError");
    fetchMock.mockRejectedValueOnce(aborted);
    await expect(api.revertSkill("p", "s", { signal: controller.signal })).rejects.toBe(aborted);
    expect(fetchMock.mock.calls[fetchMock.mock.calls.length - 1]?.[1]?.signal).toBe(controller.signal);
  });

  it("propagates a stream read failure instead of reporting success", async () => {
    const failure = new Error("Connection reset during transfer");
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ start(c) { c.error(failure); } })));
    await expect(api.promoteSkill("p", "s")).rejects.toBe(failure);
  });
});

describe("single update streaming and fallback contracts", () => {
  // 1126 P0-1: success is the `done` frame's status, not the stream's HTTP 200.
  it("extracts the version across fragmented frames", async () => {
    const text = frame("progress", { text: "é".repeat(240) }) + frame("done", { status: "done", version: "3.4.5" });
    fetchMock.mockResolvedValueOnce(streamResponse(text, 3));
    const signal = new AbortController().signal;
    const result = await api.postSkillUpdate("p", "s", { signal, agentId: "agent & local" });
    expect(result).toEqual({ ok: true, status: 200, body: "", version: "3.4.5", outcome: "done", upToDate: false });
    expectRequest("/api/skills/p/s/update?agent=agent%20%26%20local", "POST");
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(signal);
  });

  it("returns unsuccessful HTTP status and readable body without claiming a version", async () => {
    fetchMock.mockResolvedValueOnce(streamResponse("Update refused", 4, 409));
    const result = await api.postSkillUpdate("p", "s");
    expect(result).toEqual({ ok: false, status: 409, body: "Update refused", version: undefined });
  });

  it.each([true, false])("handles a response without ReadableStream (valid done = %s)", async valid => {
    const text = valid ? frame("done", { status: "done", version: "5.0.0" }) : "event: done\ndata: {broken}\n\n";
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, body: null, text: async () => text } as Response);
    const controller = new AbortController();
    const result = await api.postSkillUpdate("p", "s", controller.signal);
    // A malformed `done` frame is not a success.
    expect(result).toEqual(expect.objectContaining({ ok: valid, status: 200, version: valid ? "5.0.0" : undefined }));
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal);
  });

  it("does not invent a version from malformed streamed JSON", async () => {
    fetchMock.mockResolvedValueOnce(streamResponse("event: done\ndata: {broken}\n\n"));
    expect((await api.postSkillUpdate("p", "s")).version).toBeUndefined();
  });

  it("keeps an aborted update distinguishable from a failed HTTP update", async () => {
    const failure = new DOMException("Cancelled", "AbortError");
    fetchMock.mockRejectedValueOnce(failure);
    await expect(api.postSkillUpdate("p", "s")).rejects.toBe(failure);
  });
});

describe("best-effort registry lookup and rescans", () => {
  it("caps name lookup at 50 and rejects malformed rows while retaining usable identities", async () => {
    const entries = Array.from({ length: 55 }, (_, i) => ({ name: `skill-${i}`, author: "author" }));
    respond({ results: [null, 42, { name: "", uuid: "bad" }, { name: "skill-0", author: "author", uuid: "u-1", slug: "release-notes" }, { name: "skill-1", author: 42, uuid: "", slug: 42 }] });
    expect(await api.lookupSkillsByName(entries)).toEqual([{ name: "skill-0", author: "author", uuid: "u-1", slug: "release-notes" }, { name: "skill-1", author: "", uuid: undefined, slug: undefined }]);
    expectRequest("/api/v1/skills/lookup-by-name", "POST", { entries: entries.slice(0, 50) });
    expect(entries).toHaveLength(55);
  });

  it("does not request an empty name lookup", async () => {
    expect(await api.lookupSkillsByName([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["HTTP", "parse", "shape", "transport"])("degrades a %s lookup failure without showing an end-user error", async kind => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("window", { location: { search: "?debugSse=1" } });
    if (kind === "HTTP") respond({ error: "Unavailable" }, 503);
    else if (kind === "parse") fetchMock.mockResolvedValueOnce(new Response("invalid", { status: 200 }));
    else if (kind === "shape") respond({ results: "not-an-array" });
    else fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await api.lookupSkillsByName([{ name: "s", author: "a" }])).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not let diagnostic logging failure break graceful lookup", async () => {
    vi.stubGlobal("window", { location: { search: "?debugSse=1" } });
    vi.spyOn(console, "warn").mockImplementation(() => { throw new Error("logger unavailable"); });
    respond({}, 403);
    expect(await api.lookupSkillsByName([{ name: "s", author: "a" }])).toEqual([]);
  });

  it("queues a rescan for the full encoded identity and surfaces refusal", async () => {
    respond({ jobId: "job-1" }, 202);
    expect(await api.rescanSkill("team/repo", "release notes")).toEqual({ jobId: "job-1" });
    expectRequest("/api/v1/skills/team%2Frepo%2Frelease%20notes/rescan", "POST");
    respond({ error: "Not tracked" }, 409);
    await expect(api.rescanSkill("p", "s")).rejects.toThrow("rescan failed: HTTP 409");
  });

  it("returns polling results but tolerates HTTP and transport outages", async () => {
    const updates = [{ name: "s", installed: "1.0.0", latest: "2.0.0", updateAvailable: true }];
    respond(updates);
    expect(await api.getSkillUpdates()).toEqual(updates);
    respond({}, 500);
    expect(await api.getSkillUpdates()).toEqual([]);
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await api.getSkillUpdates()).toEqual([]);
  });
});

describe("operation history and tenant selection", () => {
  it("preserves zero-valued pagination and encodes operation deletion IDs", async () => {
    respond([]);
    expect(await api.listStudioOps({ before: 0, limit: 0 })).toEqual([]);
    expectRequest("/api/studio/ops?before=0&limit=0", "GET");
    respond([]);
    expect(await api.listStudioOps()).toEqual([]);
    expectRequest("/api/studio/ops", "GET");
    respond({ ok: true });
    expect(await api.deleteStudioOp("op/a b")).toEqual({ ok: true });
    expectRequest("/api/studio/ops/op%2Fa%20b", "DELETE");
  });

  it("lists memberships and preserves explicit clearing of the active tenant", async () => {
    respond({ tenants: [] });
    expect(await api.getAccountTenants()).toEqual({ tenants: [] });
    expectRequest("/api/v1/account/tenants", "GET");
    respond({ currentTenant: "team" });
    expect(await api.getActiveTenant()).toEqual({ currentTenant: "team" });
    expectRequest("/__internal/active-tenant", "GET");
    respond({ currentTenant: null });
    expect(await api.setActiveTenant(null)).toEqual({ currentTenant: null });
    expectRequest("/__internal/active-tenant", "POST", { currentTenant: null });
  });
});
