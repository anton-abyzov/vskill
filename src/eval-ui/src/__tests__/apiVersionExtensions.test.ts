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

describe("api.startBatchUpdate", () => {
  it("sends POST with correct body and returns EventSource", () => {
    // Mock EventSource globally
    const mockES = { addEventListener: vi.fn(), close: vi.fn() };
    vi.stubGlobal("EventSource", vi.fn(() => mockES));

    // Mock fetch for the POST
    mockFetch.mockResolvedValue(okJson({}));

    const es = api.startBatchUpdate(["architect", "pm"]);
    expect(es).toBeDefined();

    // Verify POST was sent
    expect(mockFetch).toHaveBeenCalled();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/skills/batch-update");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ skills: ["architect", "pm"] });

    vi.unstubAllGlobals();
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
