// ---------------------------------------------------------------------------
// 0759 Phase 5 — api.gitDiff + api.gitCommitMessage + api.gitPublish(commitMessage).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../api";

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function okJson(data: unknown) {
  return { ok: true, json: async () => data };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("api.gitDiff", () => {
  it("calls POST /api/git/diff and returns the parsed JSON", async () => {
    mockFetch.mockResolvedValueOnce(
      okJson({ hasChanges: true, diff: "diff --git a/x b/x\n+y\n", fileCount: 1 }),
    );

    const result = await api.gitDiff();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/git/diff");
    expect(init.method).toBe("POST");
    expect(result.hasChanges).toBe(true);
    expect(result.diff).toContain("diff --git");
    expect(result.fileCount).toBe(1);
  });
});

describe("api.gitCommitMessage", () => {
  it("calls POST /api/git/commit-message with provider+model body", async () => {
    mockFetch.mockResolvedValueOnce(okJson({ message: "feat: add x" }));

    const result = await api.gitCommitMessage({ provider: "claude-cli", model: "sonnet" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/git/commit-message");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    const body = JSON.parse(init.body as string) as { provider?: string; model?: string };
    expect(body.provider).toBe("claude-cli");
    expect(body.model).toBe("sonnet");
    expect(result.message).toBe("feat: add x");
  });

  it("works with no opts (server falls back to default provider/model)", async () => {
    mockFetch.mockResolvedValueOnce(okJson({ message: "chore: update" }));

    const result = await api.gitCommitMessage();

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({});
    expect(result.message).toBe("chore: update");
  });
});

describe("api.gitPublish (with commitMessage)", () => {
  it("forwards commitMessage in the POST body", async () => {
    mockFetch.mockResolvedValueOnce(
      okJson({
        success: true,
        commitSha: "abc1234",
        branch: "main",
        remoteUrl: "https://github.com/o/r.git",
        stdout: "[main abc1234] feat: x\n",
        stderr: "",
      }),
    );

    const result = await api.gitPublish({ commitMessage: "feat: x" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/git/publish");
    expect(init.method).toBe("POST");
    const body = JSON.parse((init.body as string) ?? "{}") as { commitMessage?: string };
    expect(body.commitMessage).toBe("feat: x");
    expect(result.success).toBe(true);
  });

  it("still works with no body (push-only behaviour)", async () => {
    mockFetch.mockResolvedValueOnce(
      okJson({
        success: true,
        commitSha: "abc",
        branch: "main",
        remoteUrl: "https://github.com/o/r.git",
        stdout: "Everything up-to-date\n",
        stderr: "",
      }),
    );

    const result = await api.gitPublish();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(result.success).toBe(true);
  });
});
