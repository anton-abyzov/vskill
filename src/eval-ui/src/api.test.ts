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

// ---------------------------------------------------------------------------
// 0712 US-003 T-016D: api.checkSkillUpdates wire contract.
//
// The vskill-platform `/api/v1/skills/check-updates` endpoint is POST-only;
// sending GET returns 405 Method Not Allowed (verified end-to-end via
// `wrangler dev` and via Claude_Preview browser network capture). These tests
// pin the wire contract so a future refactor can't silently regress to GET.
// ---------------------------------------------------------------------------
describe("api.checkSkillUpdates", () => {
  it("POSTs to /api/v1/skills/check-updates with a JSON body of sorted skill ids", async () => {
    mockFetch.mockResolvedValue(okJson({ results: [] }));
    await api.checkSkillUpdates(["b/skill", "a/skill", "c/skill"]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/skills/check-updates");
    expect(init.method).toBe("POST");
    expect(
      (init.headers as Record<string, string>)["content-type"],
    ).toBe("application/json");
    // Body must be JSON of `{ skills: <sorted> }` — sorted so the request
    // signature is stable across reorderings of the input array.
    expect(JSON.parse(init.body as string)).toEqual({
      skills: ["a/skill", "b/skill", "c/skill"],
    });
  });

  it("never issues a GET request (regression guard for the 405 bug)", async () => {
    mockFetch.mockResolvedValue(okJson({ results: [] }));
    await api.checkSkillUpdates(["a/skill"]);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    // Defensive: explicitly assert method !== "GET" because a `fetch(url)`
    // with no init also defaults to GET.
    expect(init).toBeDefined();
    expect(init.method).toBe("POST");
    expect(init.method).not.toBe("GET");
  });

  it("never appends ?skills= query string to the URL (regression guard)", async () => {
    mockFetch.mockResolvedValue(okJson({ results: [] }));
    await api.checkSkillUpdates(["a/skill", "b/skill"]);

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).not.toMatch(/\?skills=/);
    expect(url).toBe("/api/v1/skills/check-updates");
  });

  it("returns [] without a network call when given an empty list", async () => {
    const result = await api.checkSkillUpdates([]);
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("unwraps the {results: [...]} envelope from the platform", async () => {
    mockFetch.mockResolvedValue(
      okJson({
        results: [
          {
            skillId: "p/s",
            version: "2.0.0",
            eventId: "evt_01",
            publishedAt: "2026-04-25T00:00:00Z",
            trackedForUpdates: true,
            updateAvailable: true,
          },
        ],
      }),
    );
    const rows = await api.checkSkillUpdates(["p/s"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      skillId: "p/s",
      version: "2.0.0",
      eventId: "evt_01",
      trackedForUpdates: true,
      updateAvailable: true,
    });
  });

  it("accepts a flat-array legacy response shape", async () => {
    mockFetch.mockResolvedValue(
      okJson([
        {
          skillId: "p/s",
          version: "1.2.3",
          eventId: "evt_legacy",
          publishedAt: "",
        },
      ]),
    );
    const rows = await api.checkSkillUpdates(["p/s"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].skillId).toBe("p/s");
  });

  it("returns [] on non-ok response (silent failure — reconcile is best-effort)", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 405, json: async () => ({}) });
    const rows = await api.checkSkillUpdates(["p/s"]);
    expect(rows).toEqual([]);
  });

  it("returns [] when fetch itself throws (network down)", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const rows = await api.checkSkillUpdates(["p/s"]);
    expect(rows).toEqual([]);
  });
});
