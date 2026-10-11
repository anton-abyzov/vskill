// ---------------------------------------------------------------------------
// vskill audit-webmcp -- who registered a tool. Pure module: no browser.
//
//   first-party  the script is on the page's own site (registrable domain)
//   platform     the page runs on a hosting platform and the script is that
//                platform's own code (PLATFORM_HOSTS: host + path prefix,
//                and only when the page carries the platform's marker)
//   library      the script comes from a public npm CDN (unpkg, jsDelivr,
//                esm.sh, cdnjs, jspm, Skypack): a library the page author
//                chose to load
//   third-party  any other site. It may still be the site's own asset domain
//                (assets.targetimg1.com on target.com); we cannot tell.
// ---------------------------------------------------------------------------

import { siteOf } from "./score.js";
import type { RegistrarKind } from "./types.js";

/** Platform markers detected in the page (see enumerate.ts detectPlatforms). */
export type PlatformMarker = "shopify";

export interface PlatformHost {
  platform: string;
  marker: PlatformMarker;
  host: string;
  /** Only scripts under this path are the platform's own code. */
  pathPrefix: string;
}

/**
 * Hosting platforms whose own scripts register WebMCP tools on merchant
 * pages. Add an entry only after seeing it in a scan, and keep the path
 * prefix narrow: cdn.shopify.com/extensions/ holds third-party app code and
 * cdn.shopify.com/s/files/ holds any merchant's uploads.
 */
export const PLATFORM_HOSTS: PlatformHost[] = [
  // Shopify storefront WebMCP (seen 2026-10: 92 stores serve it from their own
  // domain under /cdn/shopifycloud/, cotopaxi.com from cdn.shopify.com).
  { platform: "Shopify", marker: "shopify", host: "cdn.shopify.com", pathPrefix: "/shopifycloud/" },
];

/** Public npm CDNs: the page author picks the package and version. */
export const LIBRARY_CDN_HOSTS = [
  "unpkg.com",
  "cdn.jsdelivr.net",
  "fastly.jsdelivr.net",
  "gcore.jsdelivr.net",
  "esm.sh",
  "esm.run",
  "cdnjs.cloudflare.com",
  "ga.jspm.io",
  "jspm.dev",
  "cdn.skypack.dev",
];

export interface Attribution {
  kind: RegistrarKind;
  /** Platform name for kind "platform". */
  platform?: string;
  /** Package (name@version, or gh/owner/repo@ref) for kind "library", when the URL names one. */
  package?: string;
}

/** name or name@version from path segments starting at a package name (handles @scope/name). */
function packageAt(segs: string[], i: number): string | undefined {
  const first = segs[i];
  if (!first) return undefined;
  if (first.startsWith("@")) {
    const second = segs[i + 1];
    return second ? `${first}/${second}` : undefined;
  }
  return first;
}

/** The package a public-CDN URL loads, as the URL spells it (e.g. "simple-webmcp@0.3.0"). */
export function libraryPackage(url: string): string | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  const host = u.hostname.toLowerCase();
  const segs = u.pathname.split("/").filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  if (host.endsWith("jsdelivr.net")) {
    if (segs[0] === "npm") return packageAt(segs, 1);
    if (segs[0] === "gh" && segs[1] && segs[2]) return `gh/${segs[1]}/${segs[2]}`;
    return undefined;
  }
  if (host === "cdnjs.cloudflare.com") {
    if (segs[0] === "ajax" && segs[1] === "libs" && segs[2]) return segs[3] ? `${segs[2]}@${segs[3]}` : segs[2];
    return undefined;
  }
  if (host === "ga.jspm.io" || host === "jspm.dev") {
    const s = segs.slice();
    if (s[0]?.startsWith("npm:")) s[0] = s[0].slice(4);
    return packageAt(s, 0);
  }
  if (host === "esm.sh") {
    let i = 0;
    while (segs[i] && (/^v\d+$/.test(segs[i]) || segs[i] === "stable")) i++;
    if (segs[i] === "gh" && segs[i + 1] && segs[i + 2]) return `gh/${segs[i + 1]}/${segs[i + 2]}`;
    return packageAt(segs, i);
  }
  if (host === "cdn.skypack.dev") {
    // Pinned URLs look like /-/name@v1.2.3-<hash>/dist=es2019/...
    if (segs[0] === "-") {
      const p = packageAt(segs, 1);
      return p?.replace(/@v(\d[^-]*)-[A-Za-z0-9]+$/, "@$1");
    }
    return packageAt(segs, 0);
  }
  return packageAt(segs, 0);
}

/** True when a package spec has no exact version (no @version, or a tag such as @latest). */
export function isUnpinned(pkg: string): boolean {
  const at = pkg.lastIndexOf("@");
  if (at <= 0) return true;
  const version = pkg.slice(at + 1);
  return !/^\d+\.\d+\.\d+/.test(version);
}

/**
 * Classify the script that registered a tool. Returns null when the script
 * URL is unknown or not http(s).
 */
export function classifyRegistrar(
  registeredBy: string | undefined | null,
  pageUrl: string | undefined | null,
  platforms: readonly string[] = [],
): Attribution | null {
  const regSite = siteOf(registeredBy);
  if (!registeredBy || !regSite) return null;
  const pageSite = siteOf(pageUrl);
  if (!pageSite || regSite === pageSite) return { kind: "first-party" };

  const u = new URL(registeredBy);
  const host = u.hostname.toLowerCase();
  for (const p of PLATFORM_HOSTS) {
    if (host === p.host && u.pathname.startsWith(p.pathPrefix) && platforms.includes(p.marker)) {
      return { kind: "platform", platform: p.platform };
    }
  }
  if (LIBRARY_CDN_HOSTS.includes(host)) {
    const pkg = libraryPackage(registeredBy);
    return pkg ? { kind: "library", package: pkg } : { kind: "library" };
  }
  return { kind: "third-party" };
}
