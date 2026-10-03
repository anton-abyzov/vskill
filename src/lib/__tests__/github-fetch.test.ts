// ---------------------------------------------------------------------------
// github-fetch.test.ts — unit tests for src/lib/github-fetch.ts.
// ---------------------------------------------------------------------------

import { afterEach, describe, it, expect, vi } from "vitest";
import {
  _resetDefaultGitHubFetchForTests,
  createGitHubFetch,
  GitHubFetchError,
  rawToContentsApiUrl,
  privateRepoHint,
  readGhCliToken,
  resolveDefaultGitHubToken,
  resolveGitHubEnvToken,
} from "../github-fetch.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

describe("github-fetch", () => {
  it("resolves GitHub token env fallbacks in sandbox-safe priority order", () => {
    expect(resolveGitHubEnvToken({
      GITHUB_TOKEN: "github-token",
      GH_TOKEN: "gh-token",
    })).toBe("github-token");
    expect(resolveGitHubEnvToken({
      VSKILL_TEST_PRIVATE_GITHUB_PAT: "private-token",
      GITHUB_TOKEN: "github-token",
    })).toBe("private-token");
    expect(resolveGitHubEnvToken({
      VSKILL_TEST_GITHUB_PAT: "test-token",
      VSKILL_TEST_PRIVATE_GITHUB_PAT: "private-token",
    })).toBe("test-token");
    expect(resolveGitHubEnvToken({})).toBeNull();
  });

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

describe("github-fetch — private repositories", () => {
  const RAW = "https://raw.githubusercontent.com/acme/private-skills/main/skills/foo/SKILL.md";
  const API =
    "https://api.github.com/repos/acme/private-skills/contents/skills/foo/SKILL.md?ref=main";

  function calls(fn: typeof fetch): Array<[string, RequestInit]> {
    return (fn as unknown as ReturnType<typeof vi.fn>).mock.calls as Array<[string, RequestInit]>;
  }

  it("maps raw URLs to Contents API URLs", () => {
    expect(rawToContentsApiUrl(RAW)).toBe(API);
    expect(
      rawToContentsApiUrl(
        "https://raw.githubusercontent.com/acme/r/refs/heads/develop/.claude-plugin/marketplace.json",
      ),
    ).toBe(
      "https://api.github.com/repos/acme/r/contents/.claude-plugin/marketplace.json?ref=develop",
    );
    // Signed download URLs (private files listed by the Contents API) map too.
    expect(rawToContentsApiUrl(`${RAW}?token=ABC`)).toBe(API);
    expect(rawToContentsApiUrl(`${RAW}?other=1`)).toBeNull();
    expect(rawToContentsApiUrl("https://raw.githubusercontent.com/acme/r/main")).toBeNull();
    expect(rawToContentsApiUrl("https://api.github.com/repos/acme/r")).toBeNull();
  });

  it("with a token, reads raw files through the Contents API (raw media type)", async () => {
    const fetchImpl = vi.fn(async () => new Response("# skill", { status: 200 })) as unknown as typeof fetch;
    const gh = createGitHubFetch({ tokenProvider: () => "ghp_team", fetchImpl });

    const res = await gh(RAW, { headers: { accept: "text/plain" } });

    expect(await res.text()).toBe("# skill");
    expect(calls(fetchImpl)).toHaveLength(1);
    const [url, init] = calls(fetchImpl)[0];
    expect(url).toBe(API);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ghp_team");
    expect(headers.Accept).toBe("application/vnd.github.raw");
    expect(headers.accept).toBeUndefined();
    expect(calls(fetchImpl).some(([u]) => u.startsWith("https://raw.githubusercontent.com"))).toBe(false);
  });

  it("without a token, public raw reads never touch the API", async () => {
    const fetchImpl = vi.fn(async () => new Response("# public", { status: 200 })) as unknown as typeof fetch;
    const gh = createGitHubFetch({ tokenProvider: () => null, fetchImpl });

    await gh(RAW);

    expect(calls(fetchImpl).map(([u]) => u)).toEqual([RAW]);
  });

  it("falls back to the raw host when the Contents API does not return 200", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 }))
      .mockResolvedValueOnce(new Response("# from raw", { status: 200 })) as unknown as typeof fetch;
    const gh = createGitHubFetch({ tokenProvider: () => "ghp_team", fetchImpl });

    const res = await gh(RAW);

    expect(await res.text()).toBe("# from raw");
    expect(calls(fetchImpl).map(([u]) => u)).toEqual([API, RAW]);
  });

  it("a stale token still reads public content anonymously", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("Bad credentials", { status: 401 }))
      .mockResolvedValueOnce(new Response("# public", { status: 200 })) as unknown as typeof fetch;
    const gh = createGitHubFetch({ tokenProvider: () => "ghp_expired", fetchImpl });

    const res = await gh(RAW);

    expect(await res.text()).toBe("# public");
    const [, anonInit] = calls(fetchImpl)[1];
    expect((anonInit.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("a stale token on private content surfaces the re-login hint", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("Bad credentials", { status: 401 }))
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 })) as unknown as typeof fetch;
    const gh = createGitHubFetch({ tokenProvider: () => "ghp_expired", fetchImpl });

    await expect(gh(RAW)).rejects.toMatchObject({ status: 401, message: expect.stringMatching(/vskill auth login/) });
  });
});

describe("github-fetch — token sources", () => {
  afterEach(() => {
    _resetDefaultGitHubFetchForTests();
    vi.unstubAllEnvs();
  });

  it("reads `gh auth token` once and caches it", () => {
    const exec = vi.fn(() => "gho_from_gh\n");
    expect(readGhCliToken({}, exec as never)).toBe("gho_from_gh");
    expect(readGhCliToken({}, exec as never)).toBe("gho_from_gh");
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0][0]).toBe("gh");
    expect(exec.mock.calls[0][1]).toEqual(["auth", "token"]);
  });

  it("returns null when gh is missing or signed out", () => {
    const exec = vi.fn(() => {
      throw new Error("gh: command not found");
    });
    expect(readGhCliToken({}, exec as never)).toBeNull();
  });

  it("skips gh when VSKILL_NO_GH_CLI=1", () => {
    const exec = vi.fn(() => "gho_from_gh");
    expect(readGhCliToken({ VSKILL_NO_GH_CLI: "1" }, exec as never)).toBeNull();
    expect(exec).not.toHaveBeenCalled();
  });

  it("VSKILL_GITHUB_TOKEN wins over every other source", () => {
    vi.stubEnv("VSKILL_GITHUB_TOKEN", "ghp_ci");
    vi.stubEnv("GITHUB_TOKEN", "ghp_other");
    expect(resolveDefaultGitHubToken()).toBe("ghp_ci");
  });
});

describe("privateRepoHint", () => {
  it("points at sign-in without a token, and at token access with one", () => {
    expect(privateRepoHint(() => null)).toMatch(/private repository, sign in first: `vskill auth login --repos`/);
    expect(privateRepoHint(() => "gho_readuser")).toMatch(/token cannot read it.*vskill auth login --repos/);
  });
});
