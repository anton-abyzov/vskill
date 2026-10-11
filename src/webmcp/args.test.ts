import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ArgError, DEFAULT_CONCURRENCY, DEFAULT_TIMEOUT_MS, normalizeUrl, parseUrlList, resolveOptions } from "./args.js";
import { findCachedChromium, CHROMIUM_ARGS, INIT_SCRIPT, PROBE_NAME } from "./enumerate.js";
import { shouldFail } from "../commands/audit-webmcp.js";
import { buildReport } from "./score.js";

describe("parseUrlList", () => {
  it("skips blanks and # comments, keeps order", () => {
    const text = "# shops\nallbirds.com\n\n  https://example.com/a  # trailing note\n#https://skipped.example\nhttp://x.test/#frag\r\n";
    expect(parseUrlList(text)).toEqual(["allbirds.com", "https://example.com/a", "http://x.test/#frag"]);
  });
});

describe("normalizeUrl", () => {
  it("adds https:// to bare hosts", () => {
    expect(normalizeUrl("allbirds.com")).toBe("https://allbirds.com/");
    expect(normalizeUrl("http://127.0.0.1:8080/x")).toBe("http://127.0.0.1:8080/x");
  });
  it("rejects non-http schemes and junk", () => {
    expect(() => normalizeUrl("file:///etc/passwd")).toThrow(ArgError);
    expect(() => normalizeUrl("javascript://alert(1)")).toThrow(ArgError);
    expect(() => normalizeUrl("http://")).toThrow(ArgError);
  });
});

describe("resolveOptions", () => {
  it("applies defaults for a single URL", () => {
    const o = resolveOptions(["example.com"], {});
    expect(o).toMatchObject({
      urls: ["https://example.com/"],
      json: false,
      outFormat: "json",
      concurrency: 1, // clamped to the number of URLs
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
    expect(o.failOn).toBeUndefined();
  });

  it("merges positional URLs with the urls file, dedupes, and switches to JSONL", () => {
    const o = resolveOptions(["a.example", "https://b.example/"], { out: "r.json", concurrency: "8", timeout: "15000", failOn: "HIGH" }, "b.example\nc.example\n");
    expect(o.urls).toEqual(["https://a.example/", "https://b.example/", "https://c.example/"]);
    expect(o.outFormat).toBe("jsonl");
    expect(o.concurrency).toBe(3);
    expect(o.timeoutMs).toBe(15000);
    expect(o.failOn).toBe("high");
  });

  it("uses JSONL for one URL when --out ends in .jsonl", () => {
    expect(resolveOptions(["a.example"], { out: "r.jsonl" }).outFormat).toBe("jsonl");
  });

  it("keeps the default concurrency for big batches", () => {
    const urls = Array.from({ length: 10 }, (_, i) => `s${i}.example`);
    expect(resolveOptions(urls, {}).concurrency).toBe(DEFAULT_CONCURRENCY);
  });

  it("rejects bad input with ArgError", () => {
    expect(() => resolveOptions([], {})).toThrow(/No URLs/);
    expect(() => resolveOptions(["a.example"], { failOn: "severe" })).toThrow(/--fail-on/);
    expect(() => resolveOptions(["a.example"], { concurrency: "0" })).toThrow(/--concurrency/);
    expect(() => resolveOptions(["a.example"], { timeout: "fast" })).toThrow(/--timeout/);
  });
});

describe("shouldFail", () => {
  const report = buildReport({
    url: "https://s.example/",
    finalUrl: "https://s.example/",
    documentModelContext: true,
    navigatorModelContext: false,
    permissionsPolicy: null,
    tools: [{ name: "proceed_to_checkout", annotations: {}, thirdParty: false, sources: ["getTools"], inputSchema: { type: "object" } }],
  });
  it("compares the worst finding with --fail-on", () => {
    expect(shouldFail([report], undefined)).toBe(false);
    expect(shouldFail([report], "high")).toBe(true);
    expect(shouldFail([report], "critical")).toBe(false);
  });
});

describe("browser setup constants", () => {
  it("passes one merged --enable-features flag", () => {
    expect(CHROMIUM_ARGS).toEqual(["--enable-features=CDPScreenshotNewSurface,WebMCP"]);
    expect(INIT_SCRIPT).toContain(`sourceURL=${PROBE_NAME}.js`);
    expect(INIT_SCRIPT).not.toMatch(/\.execute\s*\(|executeTool\s*\(/);
  });

  it("finds the newest cached headless shell", () => {
    const dir = mkdtempSync(join(tmpdir(), "vskill-pw-"));
    for (const rev of ["1200", "1243"]) {
      const bin = join(dir, `chromium_headless_shell-${rev}`, "chrome-headless-shell-linux64");
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, "chrome-headless-shell"), "");
    }
    expect(findCachedChromium([dir])).toBe(join(dir, "chromium_headless_shell-1243", "chrome-headless-shell-linux64", "chrome-headless-shell"));
    expect(findCachedChromium([join(dir, "missing")])).toBeNull();
  });
});
