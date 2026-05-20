import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "../router.js";
import { getStudioToken, _resetStudioTokenForTests } from "../router.js";
import { registerOauthGithubRoutes } from "../oauth-github-routes.js";

const mockSetGitHubToken = vi.hoisted(() => vi.fn());

vi.mock("../../lib/keychain.js", () => ({
  createKeychain: () => ({
    setGitHubToken: mockSetGitHubToken,
    getGitHubToken: vi.fn(),
    clearGitHubToken: vi.fn(),
  }),
}));

interface FakeResState {
  status?: number;
  body?: string;
  headers?: Record<string, string | number>;
}

function fakeReq({
  method,
  url,
  body = "",
  headers = {},
}: {
  method: string;
  url: string;
  body?: string;
  headers?: Record<string, string>;
}): IncomingMessage {
  const stream = Readable.from(body ? [body] : []);
  return Object.assign(stream, {
    method,
    url,
    headers: { host: "localhost:3077", ...headers },
  }) as unknown as IncomingMessage;
}

function fakeRes(): { res: ServerResponse; state: FakeResState } {
  const state: FakeResState = {};
  const res = {
    headersSent: false,
    writeHead: vi.fn((status: number, headers?: Record<string, string | number>) => {
      state.status = status;
      state.headers = headers;
      (res as unknown as { headersSent: boolean }).headersSent = true;
      return res;
    }),
    end: vi.fn((body?: string) => {
      state.body = body ?? "";
    }),
    setHeader: vi.fn(),
  } as unknown as ServerResponse;
  return { res, state };
}

function makeRouter(): Router {
  const router = new Router();
  registerOauthGithubRoutes(router);
  return router;
}

describe("GitHub OAuth desktop routes", () => {
  beforeEach(() => {
    _resetStudioTokenForTests();
    vi.restoreAllMocks();
    mockSetGitHubToken.mockReset();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      login: "testuser",
      id: 123,
      name: "Test User",
      email: null,
      avatar_url: "https://avatars.githubusercontent.com/u/123",
    }), { status: 200 })));
  });

  it("starts desktop OAuth against the registered platform callback without PKCE", async () => {
    const router = makeRouter();
    const { res, state } = fakeRes();
    await router.handle(fakeReq({
      method: "POST",
      url: "/api/oauth/github/start",
      body: "{}",
      headers: {
        "content-type": "application/json",
        "x-studio-token": getStudioToken(),
      },
    }), res);

    expect(state.status).toBe(200);
    const payload = JSON.parse(state.body ?? "{}") as { state: string; authUrl: string };
    expect(payload.state).toMatch(/^[A-Za-z0-9_-]{43}\.3077$/);
    const authUrl = new URL(payload.authUrl);
    expect(authUrl.origin).toBe("https://github.com");
    expect(authUrl.searchParams.get("redirect_uri")).toBe("https://verified-skill.com/api/v1/auth/github/callback");
    expect(authUrl.searchParams.get("state")).toBe(payload.state);
    expect(authUrl.searchParams.has("code_challenge")).toBe(false);
    expect(authUrl.searchParams.has("code_challenge_method")).toBe(false);
  });

  it("accepts the platform-posted token, stores it, and marks the flow ready", async () => {
    const router = makeRouter();
    const token = getStudioToken();
    const startRes = fakeRes();
    await router.handle(fakeReq({
      method: "POST",
      url: "/api/oauth/github/start",
      body: "{}",
      headers: {
        "content-type": "application/json",
        "x-studio-token": token,
      },
    }), startRes.res);
    const { state: oauthState } = JSON.parse(startRes.state.body ?? "{}") as { state: string };

    const completeRes = fakeRes();
    await router.handle(fakeReq({
      method: "POST",
      url: "/api/oauth/github/desktop-complete",
      body: new URLSearchParams({ state: oauthState, github_token: "gho_test_token" }).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    }), completeRes.res);

    expect(completeRes.state.status).toBe(200);
    expect(completeRes.state.body).toContain("Signed in as");
    expect(mockSetGitHubToken).toHaveBeenCalledWith("gho_test_token");

    const statusRes = fakeRes();
    await router.handle(fakeReq({
      method: "GET",
      url: `/api/oauth/github/status?state=${encodeURIComponent(oauthState)}`,
      headers: { "x-studio-token": token },
    }), statusRes.res);
    expect(JSON.parse(statusRes.state.body ?? "{}")).toMatchObject({
      status: "ready",
      user: { login: "testuser", id: 123 },
    });
  });
});
