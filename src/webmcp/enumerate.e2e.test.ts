// End-to-end: headless Chromium against two local http servers on 127.0.0.1.
// Skips cleanly when Playwright or a Chromium build is not available.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditSites } from "../commands/audit-webmcp.js";
import { launchBrowser, type PwBrowser } from "./enumerate.js";

const browser: PwBrowser | null = await launchBrowser().catch(() => null);

let pageServer: Server;
let widgetServer: Server;
let pageUrl = "";
let widgetOrigin = "";
const executeHits: string[] = [];

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
}

beforeAll(async () => {
  if (!browser) return;
  widgetServer = createServer((req, res) => {
    if (req.url?.startsWith("/executed")) {
      executeHits.push(req.url);
      res.end("ok");
      return;
    }
    res.setHeader("content-type", "text/javascript");
    res.end(`
      document.modelContext.registerTool({
        name: "add_to_cart",
        description: "Add a product to the shopping cart.",
        inputSchema: { type: "object", properties: { productId: { type: "string" }, quantity: { type: "number" } } },
        execute: async () => { await fetch("${"/executed?tool=add_to_cart"}"); return "added"; },
      });
    `);
  });
  const widgetPort = await listen(widgetServer);
  widgetOrigin = `http://127.0.0.1:${widgetPort}`;

  pageServer = createServer((req, res) => {
    if (req.url?.startsWith("/executed")) {
      executeHits.push(req.url);
      res.end("ok");
      return;
    }
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><html><head><title>WebMCP fixture</title></head><body>
      <form action="/executed?form=1" method="post"><input name="q"><button>Go</button></form>
      <script>
        document.modelContext.registerTool({
          name: "search_products",
          description: "Search the store catalog.",
          inputSchema: { type: "object", properties: { query: { type: "string", description: "Search terms" } } },
          annotations: { readOnlyHint: true },
          execute: async () => { await fetch("/executed?tool=search_products"); return []; },
        });
        document.modelContext.registerTool({
          name: "proceed_to_checkout",
          description: "Start checkout for the current cart.",
          inputSchema: { type: "object", properties: {} },
          annotations: { consequentialHint: true },
          execute: async () => { await fetch("/executed?tool=proceed_to_checkout"); return "ok"; },
        });
      </script>
      <script src="${widgetOrigin}/widget.js"></script>
    </body></html>`);
  });
  const pagePort = await listen(pageServer);
  pageUrl = `http://127.0.0.1:${pagePort}/`;
});

afterAll(async () => {
  await browser?.close().catch(() => {});
  pageServer?.close();
  widgetServer?.close();
});

describe.skipIf(!browser)("audit-webmcp against a local page (headless Chromium)", () => {
  it("enumerates three tools, attributes the third-party one, and never executes a tool", async (ctx) => {
    const [report] = await auditSites(browser!, [pageUrl], { concurrency: 1, timeoutMs: 15_000, settleMs: 2_000 });
    if (!report.webmcp.documentModelContext) {
      ctx.skip("this Chromium build has no WebMCP support");
      return;
    }

    expect(report.error).toBeUndefined();
    expect(report.schemaVersion).toBe(1);
    expect(report.finalUrl).toBe(pageUrl);
    expect(report.webmcp.navigatorModelContext).toBe(false);
    expect(report.headers.permissionsPolicy).toBeNull();
    expect(report.tools.map((t) => t.name).sort()).toEqual(["add_to_cart", "proceed_to_checkout", "search_products"]);

    const byName = Object.fromEntries(report.tools.map((t) => [t.name, t]));
    expect(byName.search_products.annotations.readOnlyHint).toBe(true);
    expect(byName.search_products.thirdParty).toBe(false);
    expect(byName.search_products.registeredBy).toBe(pageUrl);
    // Chrome drops consequentialHint from getTools()/CDP; the registerTool capture keeps it.
    expect(byName.proceed_to_checkout.annotations.consequentialHint).toBe(true);
    expect(byName.proceed_to_checkout.sources).toContain("registerTool");
    expect(byName.add_to_cart.thirdParty).toBe(true);
    expect(byName.add_to_cart.registeredBy).toBe(`${widgetOrigin}/widget.js`);
    expect(byName.search_products.inputSchema).toMatchObject({ type: "object" });

    const ids = report.findings.map((f) => `${f.id}:${f.tool ?? "-"}`);
    expect(ids).toContain("WMCP-005:add_to_cart");
    expect(ids).toContain("WMCP-002:add_to_cart");
    expect(ids).toContain("WMCP-008:-");
    expect(ids).not.toContain("WMCP-002:proceed_to_checkout");
    expect(ids.some((i) => i.startsWith("WMCP-003"))).toBe(false);

    expect(report.summary).toMatchObject({
      toolCount: 3,
      readOnlyCount: 1,
      consequentialCount: 1,
      writeShapedCount: 2,
      thirdPartyCount: 1,
    });

    expect(executeHits).toEqual([]);
  }, 60_000);

  it("records an error and keeps going when a site cannot be reached", async () => {
    const reports = await auditSites(
      browser!,
      ["http://127.0.0.1:9/unreachable", pageUrl],
      { concurrency: 2, timeoutMs: 10_000, settleMs: 1_000 },
    );
    expect(reports).toHaveLength(2);
    expect(reports[0].error).toBeTruthy();
    expect(reports[0].tools).toEqual([]);
    expect(reports[1].error).toBeUndefined();
  }, 60_000);
});
