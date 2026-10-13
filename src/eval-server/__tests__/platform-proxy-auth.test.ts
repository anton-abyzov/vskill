// ---------------------------------------------------------------------------
// platform-proxy-auth.test.ts — auth-injection coverage for T-041.
//
// Verifies pickHeadersForUpstream:
//   1. Adds Authorization: Bearer <token> for /api/v1/private/* and
//      /api/v1/tenants/*.
//   2. Does NOT add Authorization for /api/v1/skills/*.
//   3. Strips client-supplied Authorization on private paths to prevent
//      browser-injected token leakage to upstream.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  pickHeadersForUpstream,
  shouldInjectAuth,
  shouldProxyToPlatform,
} from "../platform-proxy.js";

describe("platform-proxy auth injection", () => {
  it("injects Bearer for /api/v1/private/* path", () => {
    const headers = pickHeadersForUpstream(
      { "user-agent": "studio/1" },
      { path: "/api/v1/private/skills/foo", tokenProvider: () => "vsk_secret" },
    );
    expect(headers.authorization).toBe("Bearer vsk_secret");
  });

  it("injects Bearer for /api/v1/tenants/* path", () => {
    const headers = pickHeadersForUpstream(
      {},
      { path: "/api/v1/tenants/abc/skills", tokenProvider: () => "vsk_t" },
    );
    expect(headers.authorization).toBe("Bearer vsk_t");
  });

  it("does NOT inject Authorization on /api/v1/skills/* (public)", () => {
    const headers = pickHeadersForUpstream(
      {},
      { path: "/api/v1/skills/list", tokenProvider: () => "vsk_secret" },
    );
    expect(headers.authorization).toBeUndefined();
    expect(headers.Authorization).toBeUndefined();
  });

  it("strips client-supplied Authorization for private paths and replaces with keychain token", () => {
    const headers = pickHeadersForUpstream(
      { authorization: "Bearer browser_supplied_garbage" },
      { path: "/api/v1/tenants/foo/skills", tokenProvider: () => "vsk_canonical" },
    );
    expect(headers.authorization).toBe("Bearer vsk_canonical");
  });

  it("when no token is available, no Authorization header is set", () => {
    const headers = pickHeadersForUpstream(
      {},
      { path: "/api/v1/private/skills/foo", tokenProvider: () => null },
    );
    expect(headers.authorization).toBeUndefined();
  });

  it("shouldProxyToPlatform recognizes private + tenant prefixes", () => {
    expect(shouldProxyToPlatform("/api/v1/private/skills/foo")).toBe(true);
    expect(shouldProxyToPlatform("/api/v1/tenants/abc")).toBe(true);
    expect(shouldProxyToPlatform("/api/v1/skills/list")).toBe(true); // existing
    expect(shouldProxyToPlatform("/api/local")).toBe(false);
  });

  it("shouldInjectAuth distinguishes private from public", () => {
    expect(shouldInjectAuth("/api/v1/tenants/x")).toBe(true);
    expect(shouldInjectAuth("/api/v1/private/y")).toBe(true);
    expect(shouldInjectAuth("/api/v1/skills/list")).toBe(false);
    expect(shouldInjectAuth("/api/v1/studio/search")).toBe(false);
  });

  // 0856: in-app submissions are proxied AND auth-required, but carry the
  // vsk_* token (see platform-proxy-submissions.test.ts for the kind proof).
  it("shouldProxyToPlatform recognizes the submissions prefix", () => {
    expect(shouldProxyToPlatform("/api/v1/submissions")).toBe(true);
    expect(shouldProxyToPlatform("/api/v1/submissions/stream/x")).toBe(true);
  });

  it("shouldInjectAuth requires auth on the submissions prefix", () => {
    expect(shouldInjectAuth("/api/v1/submissions")).toBe(true);
    expect(shouldInjectAuth("/api/v1/submissions/positions/x")).toBe(true);
  });
});


describe("0896 live billing and credential boundary", () => {
  it("proxies billing quota with the platform credential", () => {
    expect(shouldProxyToPlatform("/api/v1/billing/quota?fresh=1")).toBe(true);
    const headers = pickHeadersForUpstream({ authorization: "Bearer gho_browser" }, { path: "/api/v1/billing/quota", tokenProvider: () => "vsk_live" });
    expect(headers.authorization).toBe("Bearer vsk_live");
  });
  it.each(["gho_repo_token", "ghp_repo_token", "github_pat_private", "ghu_private"])("never forwards a GitHub credential placed in the platform slot: %s", (token) => {
    const headers = pickHeadersForUpstream({ authorization: "Bearer gho_browser" }, { path: "/api/v1/submissions", tokenProvider: () => token });
    expect(headers.authorization).toBeUndefined();
  });
});
