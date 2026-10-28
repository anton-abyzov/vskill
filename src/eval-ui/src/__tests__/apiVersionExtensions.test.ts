import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../api";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function okJson(data: unknown = []) {
  return { ok: true, json: async () => data };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("api.getSkillVersions", () => {
  it("fetches correct URL", async () => {
    mockFetch.mockResolvedValue(okJson([]));
    await api.getSkillVersions("myPlugin", "architect");
    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toBe("/api/skills/myPlugin/architect/versions");
  });
});

describe("api.getVersionDiff", () => {
  it("fetches correct URL with from/to params", async () => {
    const diffData = { from: "1.0.0", to: "2.0.0", diffSummary: "Changes", contentDiff: "diff" };
    mockFetch.mockResolvedValue(okJson(diffData));
    const result = await api.getVersionDiff("myPlugin", "architect", "1.0.0", "2.0.0");
    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toBe("/api/skills/myPlugin/architect/versions/diff?from=1.0.0&to=2.0.0");
    expect(result.from).toBe("1.0.0");
    expect(result.contentDiff).toBe("diff");
  });
});

// 1126 P0-2: batch update is one streamed POST (no EventSource GET against
// the POST-only route).
describe("api.runBatchUpdate", () => {
  it("sends POST with the skill list and resolves with the server's counts", async () => {
    const sse =
      'event: skill:start\ndata: {"skill":"architect"}\n\n' +
      'event: skill:done\ndata: {"skill":"architect","version":"2.0.0"}\n\n' +
      'event: skill:start\ndata: {"skill":"pm"}\n\n' +
      'event: skill:skipped\ndata: {"skill":"pm","reason":"pinned","pinnedVersion":"1.0.0"}\n\n' +
      'event: done\ndata: {"updated":1,"failed":0,"skipped":1}\n\n';
    mockFetch.mockResolvedValue(new Response(sse, { status: 200 }));
    const events: unknown[] = [];
    const summary = await api.runBatchUpdate(["architect", "pm"], { onEvent: (e) => events.push(e) });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/skills/batch-update");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ skills: ["architect", "pm"] });
    expect(summary).toEqual({ updated: 1, failed: 0, skipped: 1 });
    expect(events).toEqual([
      { type: "start", skill: "architect" },
      { type: "done", skill: "architect", version: "2.0.0", fromVersion: undefined, upToDate: false },
      { type: "start", skill: "pm" },
      { type: "skipped", skill: "pm", reason: "pinned", pinnedVersion: "1.0.0", message: undefined },
    ]);
  });

  it("rejects with the server's message on 409", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ error: "Update already in progress" }), { status: 409 }));
    await expect(api.runBatchUpdate(["a"])).rejects.toThrow("Update already in progress");
  });
});

describe("api.startSkillUpdate", () => {
  it("creates EventSource and sends POST for single skill", () => {
    const mockES = { addEventListener: vi.fn(), close: vi.fn() };
    vi.stubGlobal("EventSource", vi.fn(() => mockES));
    mockFetch.mockResolvedValue(okJson({}));

    const es = api.startSkillUpdate("myPlugin", "architect");
    expect(es).toBeDefined();

    expect(mockFetch).toHaveBeenCalled();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/skills/myPlugin/architect/update");
    expect(init.method).toBe("POST");

    vi.unstubAllGlobals();
  });
});
