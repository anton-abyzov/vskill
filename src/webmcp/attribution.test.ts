import { describe, expect, it } from "vitest";
import { classifyRegistrar, isUnpinned, libraryPackage } from "./attribution.js";

describe("libraryPackage", () => {
  it.each([
    ["https://unpkg.com/simple-webmcp@0.3.0/dist/index.js", "simple-webmcp@0.3.0"],
    ["https://unpkg.com/@scope/pkg@1.2.3/x.js", "@scope/pkg@1.2.3"],
    ["https://cdn.jsdelivr.net/npm/@willh/agentready@latest/dist/agentready.min.js", "@willh/agentready@latest"],
    ["https://cdn.jsdelivr.net/npm/webmcp", "webmcp"],
    ["https://cdn.jsdelivr.net/gh/owner/repo@v1/dist/a.js", "gh/owner/repo@v1"],
    ["https://esm.sh/v135/@mcp-b/global@1.0.0/es2022/global.mjs", "@mcp-b/global@1.0.0"],
    ["https://esm.sh/simple-webmcp@0.3.0", "simple-webmcp@0.3.0"],
    ["https://cdnjs.cloudflare.com/ajax/libs/webmcp/0.1.0/webmcp.min.js", "webmcp@0.1.0"],
    ["https://ga.jspm.io/npm:simple-webmcp@0.3.0/dist/index.js", "simple-webmcp@0.3.0"],
    ["https://cdn.skypack.dev/-/simple-webmcp@v0.3.0-AbCdEf123/dist=es2019,mode=imports/optimized/simple-webmcp.js", "simple-webmcp@0.3.0"],
    ["https://cdn.skypack.dev/simple-webmcp@0.3.0", "simple-webmcp@0.3.0"],
  ])("%s -> %s", (url, pkg) => {
    expect(libraryPackage(url)).toBe(pkg);
  });

  it("returns undefined when the URL names no package", () => {
    expect(libraryPackage("https://cdn.jsdelivr.net/combine/npm/a,npm/b")).toBeUndefined();
    expect(libraryPackage("https://cdnjs.cloudflare.com/polyfill/v3/polyfill.min.js")).toBeUndefined();
  });
});

describe("isUnpinned", () => {
  it("exact versions are pinned; bare names and tags are not", () => {
    expect(isUnpinned("simple-webmcp@0.3.0")).toBe(false);
    expect(isUnpinned("@scope/pkg@1.2.3")).toBe(false);
    expect(isUnpinned("@willh/agentready@latest")).toBe(true);
    expect(isUnpinned("@scope/pkg")).toBe(true);
    expect(isUnpinned("webmcp")).toBe(true);
    expect(isUnpinned("webmcp@1")).toBe(true);
    expect(isUnpinned("gh/owner/repo@0123456789abcdef0123456789abcdef01234567")).toBe(false);
    expect(isUnpinned("gh/owner/repo@main")).toBe(true);
  });
});

describe("classifyRegistrar", () => {
  it("same site is first-party; unknown or non-http scripts are null", () => {
    expect(classifyRegistrar("https://cdn.shop.example/a.js", "https://www.shop.example/")).toEqual({ kind: "first-party" });
    expect(classifyRegistrar(undefined, "https://www.shop.example/")).toBeNull();
    expect(classifyRegistrar("chrome-extension://abc/x.js", "https://www.shop.example/")).toBeNull();
  });

  it("Shopify platform code needs the host, the /shopifycloud/ path and the page marker", () => {
    const script = "https://cdn.shopify.com/shopifycloud/storefront/assets/storefront/webmcp-f427de6a.js";
    expect(classifyRegistrar(script, "https://www.cotopaxi.com/", ["shopify"])).toEqual({ kind: "platform", platform: "Shopify" });
    expect(classifyRegistrar(script, "https://www.cotopaxi.com/", [])).toEqual({ kind: "third-party" });
    expect(classifyRegistrar("https://cdn.shopify.com/s/files/1/0/other-store.js", "https://www.cotopaxi.com/", ["shopify"])).toEqual({ kind: "third-party" });
  });

  it("public npm CDNs are library; other sites, including brand asset domains, are third-party", () => {
    expect(classifyRegistrar("https://unpkg.com/simple-webmcp@0.3.0/dist/index.js", "https://emingure.github.io/simple-webmcp/demo/")).toEqual({
      kind: "library",
      package: "simple-webmcp@0.3.0",
    });
    expect(classifyRegistrar("https://cdn.jsdelivr.net/combine/npm/a,npm/b", "https://x.example/")).toEqual({ kind: "library" });
    expect(classifyRegistrar("https://assets.targetimg1.com/webui/_app.js", "https://www.target.com/")).toEqual({ kind: "third-party" });
  });
});
