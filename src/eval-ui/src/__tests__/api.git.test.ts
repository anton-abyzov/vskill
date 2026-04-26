// ---------------------------------------------------------------------------
// 0759 — api.gitRemote() + api.gitPublish() tests.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../api";

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function okJson(data: unknown) {
  return { ok: true, json: async () => data };
}

function errJson(status: number, body: unknown) {
  return {
    ok: false,
    status,
    statusText: "Server Error",
    json: async () => body,
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("api.gitRemote", () => {
  it("calls GET /api/git/remote and returns the parsed JSON", async () => {
    mockFetch.mockResolvedValueOnce(
      okJson({ remoteUrl: "https://github.com/o/r.git", branch: "main", hasRemote: true }),
    );

    const result = await api.gitRemote();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const call = mockFetch.mock.calls[0] as [string, RequestInit | undefined];
    expect(call[0]).toBe("/api/git/remote");
    // No body / GET method (RequestInit may be omitted for plain GET)
    expect(call[1]?.method).not.toBe("POST");
    expect(result).toEqual({
      remoteUrl: "https://github.com/o/r.git",
      branch: "main",
      hasRemote: true,
    });
  });

  it("propagates ApiError on HTTP non-2xx", async () => {
    mockFetch.mockResolvedValueOnce(errJson(500, { error: "boom" }));
    await expect(api.gitRemote()).rejects.toThrow();
  });
});

describe("api.gitPublish", () => {
  it("calls POST /api/git/publish and returns the parsed JSON", async () => {
    mockFetch.mockResolvedValueOnce(
      okJson({
        success: true,
        commitSha: "abc1234def567890",
        branch: "main",
        remoteUrl: "https://github.com/o/r.git",
        stdout: "Everything up-to-date\n",
        stderr: "",
      }),
    );

    const result = await api.gitPublish();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const call = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe("/api/git/publish");
    expect(call[1].method).toBe("POST");
    expect(result.success).toBe(true);
    expect(result.commitSha).toBe("abc1234def567890");
    expect(result.branch).toBe("main");
    expect(result.remoteUrl).toBe("https://github.com/o/r.git");
  });

  it("returns the failure body when the server responds 500 with success=false", async () => {
    // The API contract says the route returns HTTP 500 on push failure with
    // a JSON body — fetchJson will throw ApiError. The UI catches that error
    // and surfaces stderr in the toast. Document the throw shape here.
    mockFetch.mockResolvedValueOnce(
      errJson(500, {
        success: false,
        stdout: "",
        stderr: "rejected: non-fast-forward",
      }),
    );

    await expect(api.gitPublish()).rejects.toThrow();
  });
});
