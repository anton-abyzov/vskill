// ---------------------------------------------------------------------------
// platform-proxy-submissions.test.ts — 0856 PROXY UNLOCK regression coverage.
//
// Proves the in-app submission queue is reachable through the eval-server proxy
// AND that the per-prefix token selection injects the *vsk_* keychain token*
// (not gho_*) so an in-app submit is attributed to the signed-in user — while
// every pre-existing prefix keeps its gho_* token and the 0836 allowlist
// security property does not regress.
//
// The keychain module is mocked so each test can assert which getter
// (getVskillToken vs getGitHubToken) the proxy actually calls — the override
// path (tokenProvider) is intentionally NOT used here, because the whole point
// is to prove the kind-selection picks the correct keychain getter on its own.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";

const getGitHubTokenMock = vi.hoisted(() => vi.fn<[], string | null>());
const getVskillTokenMock = vi.hoisted(() => vi.fn<[], string | null>());

vi.mock("../../lib/keychain.js", () => ({
  getDefaultKeychain: () => ({
    getGitHubToken: getGitHubTokenMock,
    getVskillToken: getVskillTokenMock,
  }),
}));

import {
  pickHeadersForUpstream,
  shouldProxyToPlatform,
  shouldInjectAuth,
  tokenKindForPath,
  invalidatePlatformProxyTokenCache,
} from "../platform-proxy.js";

beforeEach(() => {
  getGitHubTokenMock.mockReset();
  getVskillTokenMock.mockReset();
  // Drop the per-kind 5s cache so each test reads a fresh keychain value.
  invalidatePlatformProxyTokenCache();
});

describe("0856 submissions allowlist", () => {
  it("(a) /api/v1/submissions is proxied", () => {
    expect(shouldProxyToPlatform("/api/v1/submissions")).toBe(true);
    expect(
      shouldProxyToPlatform("/api/v1/submissions/stream/abc-123"),
    ).toBe(true);
    expect(
      shouldProxyToPlatform("/api/v1/submissions/positions/abc-123"),
    ).toBe(true);
  });

  it("(a) /api/v1/submissions requires auth injection", () => {
    expect(shouldInjectAuth("/api/v1/submissions")).toBe(true);
    expect(shouldInjectAuth("/api/v1/submissions/stream/abc-123")).toBe(true);
    expect(shouldInjectAuth("/api/v1/submissions/positions/abc-123")).toBe(true);
  });

  it("(a) tokenKindForPath maps submissions → vskill", () => {
    expect(tokenKindForPath("/api/v1/submissions")).toBe("vskill");
    expect(tokenKindForPath("/api/v1/submissions/stream/x")).toBe("vskill");
    expect(tokenKindForPath("/api/v1/submissions/positions/x")).toBe("vskill");
  });
});

describe("0856 per-prefix token injection (real keychain getters)", () => {
  it("(a) injects the vsk_* token for POST /api/v1/submissions", () => {
    getVskillTokenMock.mockReturnValue("vsk_live_abc123");
    getGitHubTokenMock.mockReturnValue("gho_should_not_be_used");

    const headers = pickHeadersForUpstream(
      { "content-type": "application/json" },
      { path: "/api/v1/submissions" },
    );

    expect(headers.authorization).toBe("Bearer vsk_live_abc123");
    expect(getVskillTokenMock).toHaveBeenCalledTimes(1);
    // The GitHub getter must NOT be consulted for the submissions prefix.
    expect(getGitHubTokenMock).not.toHaveBeenCalled();
  });

  it("(a) injects the vsk_* token for the submissions sub-resource streams", () => {
    getVskillTokenMock.mockReturnValue("vsk_live_stream");

    const headers = pickHeadersForUpstream(
      {},
      { path: "/api/v1/submissions/stream/abc-123" },
    );

    expect(headers.authorization).toBe("Bearer vsk_live_stream");
    expect(getVskillTokenMock).toHaveBeenCalled();
    expect(getGitHubTokenMock).not.toHaveBeenCalled();
  });

  it("(a) strips any client-supplied Authorization on the submissions path", () => {
    getVskillTokenMock.mockReturnValue("vsk_canonical");

    const headers = pickHeadersForUpstream(
      { authorization: "Bearer browser_supplied_vsk_garbage" },
      { path: "/api/v1/submissions" },
    );

    expect(headers.authorization).toBe("Bearer vsk_canonical");
  });

  it("(a) when no vsk_* token exists, NO Authorization is set (anonymous submit)", () => {
    getVskillTokenMock.mockReturnValue(null);

    const headers = pickHeadersForUpstream(
      {},
      { path: "/api/v1/submissions" },
    );

    expect(headers.authorization).toBeUndefined();
    expect(getGitHubTokenMock).not.toHaveBeenCalled();
  });

  // 1.2.1: the GitHub token can read private repos (Studio sign-in asks for
  // `repo`; `vskill auth login --repos` uses the same slot), so it is never
  // sent to verified-skill.com. Every authenticated prefix carries vsk_*.
  for (const path of ["/api/v1/account/profile", "/api/v1/private/skills/foo", "/api/v1/tenants/abc/skills"]) {
    it(`(b) ${path} injects the vsk_* token, never the GitHub token`, () => {
      getGitHubTokenMock.mockReturnValue("gho_repo_scoped");
      getVskillTokenMock.mockReturnValue("vsk_signed_in");

      const headers = pickHeadersForUpstream({ authorization: "Bearer gho_from_browser" }, { path });

      expect(headers.authorization).toBe("Bearer vsk_signed_in");
      expect(getGitHubTokenMock).not.toHaveBeenCalled();
    });

    it(`(b) ${path} is anonymous when only a GitHub token is stored`, () => {
      getGitHubTokenMock.mockReturnValue("gho_repo_scoped");
      getVskillTokenMock.mockReturnValue(null);

      const headers = pickHeadersForUpstream({}, { path });

      expect(headers.authorization).toBeUndefined();
      expect(getGitHubTokenMock).not.toHaveBeenCalled();
    });
  }

  it("(b) tokenKindForPath is vskill for every path", () => {
    expect(tokenKindForPath("/api/v1/account/profile")).toBe("vskill");
    expect(tokenKindForPath("/api/v1/private/skills/foo")).toBe("vskill");
    expect(tokenKindForPath("/api/v1/tenants/abc")).toBe("vskill");
    expect(tokenKindForPath(undefined)).toBe("vskill");
  });
});

describe("0856 security property must NOT regress (0836)", () => {
  it("(c) a non-allowlisted /api path is STILL blocked from proxying", () => {
    expect(shouldProxyToPlatform("/api/config")).toBe(false);
    expect(shouldProxyToPlatform("/api/skills")).toBe(false); // legacy local
    expect(shouldProxyToPlatform("/api/v1/foo")).toBe(false);
    expect(shouldProxyToPlatform("/api/v1/submission")).toBe(false); // typo, no 's'
    expect(shouldProxyToPlatform("/api/agents")).toBe(false);
  });

  it("(c) a non-allowlisted /api path NEVER receives an injected bearer", () => {
    getGitHubTokenMock.mockReturnValue("gho_secret");
    getVskillTokenMock.mockReturnValue("vsk_secret");

    const headers = pickHeadersForUpstream({}, { path: "/api/config" });

    expect(headers.authorization).toBeUndefined();
    expect(getGitHubTokenMock).not.toHaveBeenCalled();
    expect(getVskillTokenMock).not.toHaveBeenCalled();
  });
});

describe("0856 must NOT regress public skills proxy (0855 SSE)", () => {
  it("(d) /api/v1/skills/stream is proxied but anonymous (no auth injected)", () => {
    getGitHubTokenMock.mockReturnValue("gho_secret");
    getVskillTokenMock.mockReturnValue("vsk_secret");

    expect(shouldProxyToPlatform("/api/v1/skills/stream?skills=x")).toBe(true);
    expect(shouldInjectAuth("/api/v1/skills/stream")).toBe(false);

    const headers = pickHeadersForUpstream(
      {},
      { path: "/api/v1/skills/stream" },
    );

    expect(headers.authorization).toBeUndefined();
    // No keychain read at all on the public SSE path.
    expect(getGitHubTokenMock).not.toHaveBeenCalled();
    expect(getVskillTokenMock).not.toHaveBeenCalled();
  });

  it("(d) /api/v1/skills/check-updates stays anonymous through the proxy", () => {
    getVskillTokenMock.mockReturnValue("vsk_secret");

    const headers = pickHeadersForUpstream(
      {},
      { path: "/api/v1/skills/check-updates" },
    );

    expect(headers.authorization).toBeUndefined();
    expect(getVskillTokenMock).not.toHaveBeenCalled();
  });
});
