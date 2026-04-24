// ---------------------------------------------------------------------------
// 0698 T-014: useWorkspace — pure fetch wire tests.
//
// The hook itself is a thin wrapper over useSWR + the API functions. We test
// the API functions (URL, method, body, error surface) and the cache
// invalidation helper directly — which matches the coverage the plan calls
// for and avoids a heavyweight @testing-library/react dependency.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchWorkspaceApi,
  postActiveProjectApi,
  postAddProjectApi,
  deleteProjectApi,
  invalidateWorkspaceDependents,
} from "../useWorkspace";
import * as swr from "../useSWR";

const mockFetch = vi.fn();
global.fetch = mockFetch as typeof fetch;

function okJson<T>(data: T): Response {
  return { ok: true, status: 200, json: async () => data } as unknown as Response;
}

function errJson(status: number, body: unknown): Response {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

const emptyWorkspace = { version: 1, activeProjectId: null, projects: [] } as const;

beforeEach(() => {
  mockFetch.mockReset();
});

describe("fetchWorkspaceApi (0698 T-014)", () => {
  it("GETs /api/workspace and returns the parsed workspace", async () => {
    mockFetch.mockResolvedValueOnce(okJson(emptyWorkspace));
    const ws = await fetchWorkspaceApi();
    expect(mockFetch).toHaveBeenCalledWith("/api/workspace");
    expect(ws).toEqual(emptyWorkspace);
  });

  it("throws on non-2xx", async () => {
    mockFetch.mockResolvedValueOnce(errJson(500, { error: "boom" }));
    await expect(fetchWorkspaceApi()).rejects.toThrow(/500/);
  });
});

describe("postActiveProjectApi (0698 T-014)", () => {
  it("POSTs { id } to /api/workspace/active with JSON body", async () => {
    mockFetch.mockResolvedValueOnce(okJson(emptyWorkspace));
    await postActiveProjectApi("abc123");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/workspace/active",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "abc123" }),
      }),
    );
  });

  it("accepts null to clear active", async () => {
    mockFetch.mockResolvedValueOnce(okJson(emptyWorkspace));
    await postActiveProjectApi(null);
    const [, init] = mockFetch.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ id: null });
  });

  it("surfaces the server error message", async () => {
    mockFetch.mockResolvedValueOnce(errJson(404, { error: "Project id not found: zzz" }));
    await expect(postActiveProjectApi("zzz")).rejects.toThrow(/Project id not found/);
  });
});

describe("postAddProjectApi (0698 T-014)", () => {
  it("POSTs { path, name } to /api/workspace/projects", async () => {
    mockFetch.mockResolvedValueOnce(okJson(emptyWorkspace));
    await postAddProjectApi({ path: "/new", name: "new" });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/workspace/projects");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ path: "/new", name: "new" });
  });

  it("allows name to be omitted", async () => {
    mockFetch.mockResolvedValueOnce(okJson(emptyWorkspace));
    await postAddProjectApi({ path: "/only-path" });
    expect(
      JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string),
    ).toEqual({ path: "/only-path" });
  });

  it("surfaces server 409 duplicate error", async () => {
    mockFetch.mockResolvedValueOnce(errJson(409, { error: "Duplicate project path already registered" }));
    await expect(postAddProjectApi({ path: "/dup" })).rejects.toThrow(/Duplicate/);
  });
});

describe("deleteProjectApi (0698 T-014)", () => {
  it("DELETEs /api/workspace/projects/:id (url-encoded)", async () => {
    mockFetch.mockResolvedValueOnce(okJson(emptyWorkspace));
    await deleteProjectApi("abc/123");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/workspace/projects/abc%2F123");
    expect((init as RequestInit).method).toBe("DELETE");
  });

  it("throws on 404", async () => {
    mockFetch.mockResolvedValueOnce(errJson(404, { error: "Project id not found: bogus" }));
    await expect(deleteProjectApi("bogus")).rejects.toThrow(/not found/i);
  });
});

describe("invalidateWorkspaceDependents (0698 T-014)", () => {
  it("calls mutate() for 'skills' and 'agents' cache keys", () => {
    const spy = vi.spyOn(swr, "mutate");
    invalidateWorkspaceDependents();
    expect(spy).toHaveBeenCalledWith("skills");
    expect(spy).toHaveBeenCalledWith("agents");
    spy.mockRestore();
  });
});
