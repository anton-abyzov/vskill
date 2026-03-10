import { describe, it, expect, vi, beforeEach } from "vitest";
import { api, ApiError } from "./api";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function okJson(data: unknown = []) {
  return { ok: true, json: async () => data };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("api.getHistory", () => {
  it("appends all filter params to URL", async () => {
    mockFetch.mockResolvedValue(okJson());
    await api.getHistory("p", "s", {
      model: "gpt-4o",
      type: "benchmark",
      from: "2026-01-01",
      to: "2026-03-01",
    });
    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toContain("/api/skills/p/s/history?");
    expect(url).toContain("model=gpt-4o");
    expect(url).toContain("type=benchmark");
    expect(url).toContain("from=2026-01-01");
    expect(url).toContain("to=2026-03-01");
  });

  it("has no query string when no filters given", async () => {
    mockFetch.mockResolvedValue(okJson());
    await api.getHistory("p", "s");
    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toBe("/api/skills/p/s/history");
  });
});

describe("api.compareRuns", () => {
  it("fetches the correct URL with a and b params", async () => {
    mockFetch.mockResolvedValue(okJson({}));
    await api.compareRuns("p", "s", "ts-a", "ts-b");
    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toContain("/api/skills/p/s/history-compare?");
    expect(url).toContain("a=ts-a");
    expect(url).toContain("b=ts-b");
  });
});

describe("api.getCaseHistory", () => {
  it("includes model in query string when provided", async () => {
    mockFetch.mockResolvedValue(okJson());
    await api.getCaseHistory("p", "s", 42, "gpt-4o");
    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toContain("/api/skills/p/s/history/case/42?model=gpt-4o");
  });

  it("has no query string when model is omitted", async () => {
    mockFetch.mockResolvedValue(okJson());
    await api.getCaseHistory("p", "s", 42);
    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toBe("/api/skills/p/s/history/case/42");
  });
});

describe("ApiError on non-ok response", () => {
  it("throws ApiError with status on non-ok response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({ error: "skill not found" }),
    });
    await expect(api.getHistory("p", "s")).rejects.toThrow(ApiError);
    try {
      await api.getHistory("p", "s");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
      expect((err as ApiError).message).toBe("skill not found");
    }
  });
});
