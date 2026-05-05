// 0827 — api.getSkillInstallState typed wrapper for GET /api/studio/install-state.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "../api";

const mockFetch = vi.fn();
global.fetch = mockFetch as typeof fetch;

function okJson(data: unknown) {
  return { ok: true, json: async () => data } as unknown as Response;
}
function failJson(status: number, body: unknown = {}) {
  return {
    ok: false,
    status,
    statusText: "ERR",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(() => mockFetch.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("0827 — api.getSkillInstallState", () => {
  const sample = {
    skill: "gitroomhq/postiz-agent/postiz",
    detectedAgentTools: [
      { id: "claude-code", displayName: "Claude Code", localDir: ".claude/skills", globalDir: "~/.claude/skills" },
    ],
    scopes: {
      project: { installed: false, installedAgentTools: [], version: null },
      user: { installed: true, installedAgentTools: ["claude-code"], version: "2.0.12" },
    },
  };

  it("calls the install-state endpoint with the encoded skill name and parses the response", async () => {
    mockFetch.mockResolvedValue(okJson(sample));
    const result = await api.getSkillInstallState("gitroomhq/postiz-agent/postiz");

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/studio/install-state?skill=gitroomhq%2Fpostiz-agent%2Fpostiz",
      expect.objectContaining({}),
    );
    expect(result).toEqual(sample);
    expect(result.scopes.user.installed).toBe(true);
    expect(result.scopes.user.version).toBe("2.0.12");
  });

  it("rejects when the endpoint returns a non-2xx response", async () => {
    mockFetch.mockResolvedValue(failJson(500));
    await expect(api.getSkillInstallState("foo/bar/baz")).rejects.toThrow(/HTTP 500/);
  });
});
