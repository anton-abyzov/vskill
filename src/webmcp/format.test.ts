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
    expect(out).toMatch(/proceed_to_checkout\s+-\s+-\s+no/);
    expect(out).toMatch(/HIGH\s+WMCP-002\s+proceed_to_checkout:/);
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
