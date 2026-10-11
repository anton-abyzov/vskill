import { describe, expect, it } from "vitest";
import { formatBatchFooter, formatSiteTerminal } from "./format.js";
import { buildReport } from "./score.js";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

const ok = buildReport({
  url: "https://shop.example/",
  finalUrl: "https://www.shop.example/",
  documentModelContext: true,
  navigatorModelContext: false,
  permissionsPolicy: null,
  tools: [
    { name: "search_catalog", annotations: { readOnlyHint: true }, thirdParty: false, sources: ["getTools"], inputSchema: { type: "object" }, description: "Search." },
    { name: "proceed_to_checkout", annotations: {}, thirdParty: false, sources: ["getTools"], inputSchema: { type: "object" }, description: "Checkout." },
  ],
});

const failed = buildReport({
  url: "https://down.example/",
  finalUrl: null,
  documentModelContext: false,
  navigatorModelContext: false,
  permissionsPolicy: null,
  tools: [],
  error: "net::ERR_NAME_NOT_RESOLVED at https://down.example/",
});

describe("formatSiteTerminal", () => {
  it("prints the redirect, counts, a tool row and findings", () => {
    const out = strip(formatSiteTerminal(ok));
    expect(out).toContain("https://shop.example/ -> https://www.shop.example/");
    expect(out).toContain("2 tools: 1 read-only, 0 consequential, 1 write-shaped, 0 third-party");
    // No registering script known: source "-".
    expect(out).toMatch(/proceed_to_checkout\s+-\s+-\s+-\s/);
    expect(out).toMatch(/HIGH\s+WMCP-002\s+proceed_to_checkout:/);
  });

  it("labels each tool's source and counts platform and library tools", () => {
    const r = buildReport({
      url: "https://www.shop.example/",
      finalUrl: "https://www.shop.example/",
      documentModelContext: true,
      navigatorModelContext: false,
      permissionsPolicy: "tools=(self)",
      platforms: ["shopify"],
      tools: [
        { name: "get_a", annotations: { readOnlyHint: true }, thirdParty: false, sources: ["getTools"], inputSchema: { type: "object" }, registeredBy: "https://cdn.shopify.com/shopifycloud/s.js", registeredByKind: "platform", registeredByPlatform: "Shopify" },
        { name: "get_b", annotations: { readOnlyHint: true }, thirdParty: false, sources: ["getTools"], inputSchema: { type: "object" }, registeredBy: "https://unpkg.com/w@1.0.0/i.js", registeredByKind: "library", registeredByPackage: "w@1.0.0" },
        { name: "get_c", annotations: { readOnlyHint: true }, thirdParty: true, sources: ["getTools"], inputSchema: { type: "object" }, registeredBy: "https://assets.img.example/a.js", registeredByKind: "third-party" },
        { name: "get_d", annotations: { readOnlyHint: true }, thirdParty: false, sources: ["getTools"], inputSchema: { type: "object" }, registeredBy: "https://www.shop.example/a.js", registeredByKind: "first-party" },
      ],
    });
    const out = strip(formatSiteTerminal(r));
    expect(out).toContain("1 third-party, 1 platform, 1 library");
    expect(out).toMatch(/get_a\s+yes\s+-\s+platform\s+cdn\.shopify\.com/);
    expect(out).toMatch(/get_b\s+yes\s+-\s+library\s+unpkg\.com/);
    expect(out).toMatch(/get_c\s+yes\s+-\s+3rd\s+assets\.img\.example/);
    expect(out).toMatch(/get_d\s+yes\s+-\s+1st\s+www\.shop\.example/);
    expect(out).toMatch(/INFO\s+WMCP-005\s+get_b:/);
    expect(out).toMatch(/MEDIUM\s+WMCP-005\s+get_c:/);
    expect(out).not.toMatch(/WMCP-005\s+get_a:/);
  });

  it("shows ERROR without a score for a site that failed to load", () => {
    const out = strip(formatSiteTerminal(failed));
    expect(out).toContain("ERROR");
    expect(out).not.toContain("score");
    expect(out).toContain("ERR_NAME_NOT_RESOLVED");
  });
});

describe("formatBatchFooter", () => {
  it("counts verdicts and errors separately", () => {
    expect(strip(formatBatchFooter([ok, failed]))).toBe(
      "2 sites: 1 expose WebMCP tools | 0 PASS, 1 CONCERNS, 0 FAIL, 1 errors",
    );
  });
});
