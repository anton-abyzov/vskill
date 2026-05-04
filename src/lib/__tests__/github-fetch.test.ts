// ---------------------------------------------------------------------------
// github-fetch.test.ts — unit tests for src/lib/github-fetch.ts.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { createGitHubFetch, GitHubFetchError } from "../github-fetch.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

describe("github-fetch", () => {
  it("attaches Authorization header for api.github.com when token present", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true })) as unknown as typeof fetch;
    const gh = createGitHubFetch({
      tokenProvider: () => "ghu_token",
      fetchImpl,
      version: "9.9.9",
    });

    await gh("https://api.github.com/repos/acme/x");
    const callArgs = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    const init = callArgs[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ghu_token");
    expect(headers["User-Agent"]).toBe("vskill/9.9.9");
  });

  it("does NOT attach Authorization when no token is available", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true })) as unknown as typeof fetch;
    const gh = createGitHubFetch({
      tokenProvider: () => null,
      fetchImpl,
      version: "1.0.0",
    });

    await gh("https://raw.githubusercontent.com/acme/x/main/README.md");
    const init = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("rejects URLs outside the allowlist (SSRF guard)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true })) as unknown as typeof fetch;
    const gh = createGitHubFetch({
      tokenProvider: () => "ghu_token",
      fetchImpl,
    });

    await expect(gh("https://evil.example.com/api")).rejects.toThrow(/host not allowed/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects /search/code URLs (rate-limit guardrail)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ items: [] })) as unknown as typeof fetch;
    const gh = createGitHubFetch({ tokenProvider: () => null, fetchImpl });
    await expect(gh("https://api.github.com/search/code?q=foo")).rejects.toThrow(
      /search\/code is not permitted/i,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retries on 429 with Retry-After (max retries respected)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("rate limited", { status: 429, headers: { "retry-after": "0" } }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true })) as unknown as typeof fetch;
    const gh = createGitHubFetch({
      tokenProvider: () => null,
      fetchImpl,
      sleep: () => Promise.resolve(),
    });
    const res = await gh("https://api.github.com/repos/a/b");
    expect(res.status).toBe(200);
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it("throws GitHubFetchError with auth-hint on 401", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("Bad creds", { status: 401 }),
    ) as unknown as typeof fetch;
    const gh = createGitHubFetch({ tokenProvider: () => "ghu_x", fetchImpl });
    try {
      await gh("https://api.github.com/repos/acme/private");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(GitHubFetchError);
      const ge = err as GitHubFetchError;
      expect(ge.status).toBe(401);
      expect(ge.message).toMatch(/vskill auth login/i);
    }
  });
});
