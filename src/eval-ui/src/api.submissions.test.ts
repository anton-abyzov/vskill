// ---------------------------------------------------------------------------
// 0856 — api.ts submission-queue client method tests.
//
// These cover the four new proxied methods: submitToQueue (+ its outcome
// mapping across all five platform branches), getMyQueue, getSubmission, and
// getPositions. fetch is mocked; the methods issue same-origin relative URLs
// (the X-Studio-Token bridge + eval-server proxy are out of scope here).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { api, ApiError } from "./api";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function okJson(data: unknown) {
  return { ok: true, json: async () => data };
}
function errJson(status: number, body: unknown) {
  return { ok: false, status, statusText: "Error", json: async () => body };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("api.submitToQueue", () => {
  it("POSTs /api/v1/submissions with a JSON body + content-type", async () => {
    mockFetch.mockResolvedValue(
      okJson({ id: "s1", skillName: "greet", skillPath: "skills/greet", state: "RECEIVED", createdAt: "2026-05-30T00:00:00Z" }),
    );
    await api.submitToQueue({
      repoUrl: "https://github.com/owner/repo",
      skillName: "greet",
      skillPath: "skills/greet",
      source: "studio-submit",
      privacy: "public",
    });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/v1/submissions");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      repoUrl: "https://github.com/owner/repo",
      skillName: "greet",
      skillPath: "skills/greet",
      source: "studio-submit",
      privacy: "public",
    });
  });

  it("maps the created branch", async () => {
    mockFetch.mockResolvedValue(
      okJson({ id: "s1", skillName: "greet", skillPath: "p", state: "RECEIVED", createdAt: "2026-05-30T00:00:00Z" }),
    );
    const res = await api.submitToQueue({ repoUrl: "https://github.com/o/r", skillName: "greet" });
    expect(res).toEqual({
      kind: "created",
      id: "s1",
      skillName: "greet",
      skillPath: "p",
      state: "RECEIVED",
      createdAt: "2026-05-30T00:00:00Z",
    });
  });

  it("maps the duplicate branch", async () => {
    mockFetch.mockResolvedValue(okJson({ id: "s2", state: "TIER1_SCANNING", duplicate: true }));
    const res = await api.submitToQueue({ repoUrl: "https://github.com/o/r", skillName: "greet" });
    expect(res).toEqual({ kind: "duplicate", id: "s2", state: "TIER1_SCANNING" });
  });

  it("maps the alreadyVerified branch", async () => {
    mockFetch.mockResolvedValue(okJson({ skillId: "sk1", skillName: "greet", alreadyVerified: true }));
    const res = await api.submitToQueue({ repoUrl: "https://github.com/o/r", skillName: "greet" });
    expect(res).toEqual({ kind: "alreadyVerified", skillId: "sk1", skillName: "greet" });
  });

  it("maps the requeued branch", async () => {
    mockFetch.mockResolvedValue(okJson({ id: "s3", state: "RECEIVED", requeued: true }));
    const res = await api.submitToQueue({ repoUrl: "https://github.com/o/r", skillName: "greet" });
    expect(res).toEqual({ kind: "requeued", id: "s3", state: "RECEIVED" });
  });

  it("maps the blocked branch", async () => {
    mockFetch.mockResolvedValue(okJson({ blocked: true, submissionId: "s4" }));
    const res = await api.submitToQueue({ repoUrl: "https://github.com/o/r", skillName: "evil" });
    expect(res).toEqual({ kind: "blocked", submissionId: "s4" });
  });

  it("forwards a 400 validation error as ApiError with details", async () => {
    mockFetch.mockResolvedValue(
      errJson(400, { error: "Validation failed", errors: ["repoUrl invalid"] }),
    );
    await expect(
      api.submitToQueue({ repoUrl: "notaurl", skillName: "x" }),
    ).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
    });
    try {
      await api.submitToQueue({ repoUrl: "notaurl", skillName: "x" });
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).details).toMatchObject({ error: "Validation failed" });
    }
  });
});

describe("api.getMyQueue", () => {
  it("GETs /api/v1/submissions?mine=1 and returns the envelope", async () => {
    const payload = {
      submissions: [{ id: "s1", skillName: "greet", repoUrl: "https://github.com/o/r", state: "RECEIVED", createdAt: "x", updatedAt: "y" }],
      total: 1,
      queuePositions: { s1: 3 },
    };
    mockFetch.mockResolvedValue(okJson(payload));
    const res = await api.getMyQueue();
    expect(mockFetch.mock.calls[0][0]).toBe("/api/v1/submissions?mine=1");
    expect(res).toEqual(payload);
  });
});

describe("api.getSubmission", () => {
  it("GETs /api/v1/submissions/:id with an encoded id", async () => {
    mockFetch.mockResolvedValue(okJson({ id: "a b", state: "PUBLISHED" }));
    await api.getSubmission("a b");
    expect(mockFetch.mock.calls[0][0]).toBe("/api/v1/submissions/a%20b");
  });
});

describe("api.getPositions", () => {
  it("GETs /positions with no query when no ids given", async () => {
    mockFetch.mockResolvedValue(okJson({ positions: {}, total: 0 }));
    await api.getPositions();
    expect(mockFetch.mock.calls[0][0]).toBe("/api/v1/submissions/positions");
  });

  it("GETs /positions?ids=... when ids are given", async () => {
    mockFetch.mockResolvedValue(okJson({ positions: { s1: 1 }, total: 1 }));
    await api.getPositions(["s1", "s2"]);
    expect(mockFetch.mock.calls[0][0]).toBe("/api/v1/submissions/positions?ids=s1%2Cs2");
  });
});
