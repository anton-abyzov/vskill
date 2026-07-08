// ---------------------------------------------------------------------------
// 0851 — Postiz-class manifest conflict healing
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  hasComponentFields,
  healManifestContent,
  healMarketplaceDir,
  healPluginCacheDir,
  healAllMarketplaceManifests,
} from "./manifest-conflict.js";

// The exact shape that broke postiz@postiz-agent in Claude Code:
// marketplace entry with strict:false AND skills, plugin.json also with skills.
const POSTIZ_MARKETPLACE = {
  name: "postiz-agent",
  owner: { name: "Nevo David" },
  plugins: [
    {
      name: "postiz",
      description: "Social media automation",
      source: "./",
      strict: false,
      skills: ["./"],
    },
  ],
};

const POSTIZ_PLUGIN_JSON = {
  name: "postiz",
  version: "2.0.12",
  skills: ["./"],
};

describe("hasComponentFields", () => {
  it("detects each component field", () => {
    for (const f of ["skills", "commands", "agents", "hooks", "mcpServers"]) {
      expect(hasComponentFields({ [f]: [] })).toBe(true);
    }
  });

  it("ignores non-component fields and null", () => {
    expect(hasComponentFields({ name: "x", version: "1.0.0" })).toBe(false);
    expect(hasComponentFields(null)).toBe(false);
    expect(hasComponentFields(undefined)).toBe(false);
  });
});

describe("healManifestContent", () => {
  it("heals the postiz shape: strict:true set, component fields dropped", () => {
    const result = healManifestContent(JSON.stringify(POSTIZ_MARKETPLACE), () => true);
    expect(result.healed).toEqual([{ plugin: "postiz" }]);
    const manifest = JSON.parse(result.content!);
    expect(manifest.plugins[0].strict).toBe(true);
    expect(manifest.plugins[0].skills).toBeUndefined();
    // Non-component fields survive
    expect(manifest.plugins[0].source).toBe("./");
    expect(manifest.plugins[0].description).toBe("Social media automation");
  });

  it("leaves entries alone when plugin.json has no components", () => {
    const result = healManifestContent(JSON.stringify(POSTIZ_MARKETPLACE), () => false);
    expect(result.content).toBeNull();
    expect(result.healed).toEqual([]);
  });

  it("leaves strict:true entries alone", () => {
    const manifest = structuredClone(POSTIZ_MARKETPLACE);
    (manifest.plugins[0] as Record<string, unknown>).strict = true;
    const result = healManifestContent(JSON.stringify(manifest), () => true);
    expect(result.content).toBeNull();
  });

  it("leaves entries without component fields alone", () => {
    const manifest = structuredClone(POSTIZ_MARKETPLACE);
    delete (manifest.plugins[0] as Record<string, unknown>).skills;
    const result = healManifestContent(JSON.stringify(manifest), () => true);
    expect(result.content).toBeNull();
  });

  it("returns null content on invalid JSON or missing plugins array", () => {
    expect(healManifestContent("not json", () => true).content).toBeNull();
    expect(healManifestContent('{"name":"x"}', () => true).content).toBeNull();
  });

  it("heals every component field variant, not just skills", () => {
    const manifest = {
      name: "m",
      plugins: [
        { name: "a", source: "./a", commands: ["./cmd"], agents: ["./ag"] },
        { name: "b", source: "./b", hooks: { x: 1 }, mcpServers: { y: 2 } },
      ],
    };
    const result = healManifestContent(JSON.stringify(manifest), () => true);
    expect(result.healed.map((h) => h.plugin)).toEqual(["a", "b"]);
    const out = JSON.parse(result.content!);
    for (const entry of out.plugins) {
      expect(entry.strict).toBe(true);
      for (const f of ["skills", "commands", "agents", "hooks", "mcpServers"]) {
        expect(entry[f]).toBeUndefined();
      }
    }
  });
});

describe("filesystem healing", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "vskill-heal-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function writeMarketplaceDir(dir: string): void {
    mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(dir, ".claude-plugin", "marketplace.json"),
      JSON.stringify(POSTIZ_MARKETPLACE, null, 2),
      "utf8",
    );
    writeFileSync(
      join(dir, ".claude-plugin", "plugin.json"),
      JSON.stringify(POSTIZ_PLUGIN_JSON, null, 2),
      "utf8",
    );
  }

  it("healMarketplaceDir fixes a broken registered marketplace in place", () => {
    const mpDir = join(tmp, "postiz-agent");
    writeMarketplaceDir(mpDir);

    const healed = healMarketplaceDir(mpDir);
    expect(healed).toEqual(["postiz"]);

    const after = JSON.parse(
      readFileSync(join(mpDir, ".claude-plugin", "marketplace.json"), "utf8"),
    );
    expect(after.plugins[0].strict).toBe(true);
    expect(after.plugins[0].skills).toBeUndefined();

    // Idempotent: second run is a no-op
    expect(healMarketplaceDir(mpDir)).toEqual([]);
  });

  it("healMarketplaceDir resolves ./plugins/<name> sources", () => {
    const mpDir = join(tmp, "mp");
    mkdirSync(join(mpDir, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(mpDir, ".claude-plugin", "marketplace.json"),
      JSON.stringify({
        name: "mp",
        plugins: [{ name: "foo", source: "./plugins/foo", skills: ["./"] }],
      }),
      "utf8",
    );
    mkdirSync(join(mpDir, "plugins", "foo", ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(mpDir, "plugins", "foo", ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "foo", skills: ["./"] }),
      "utf8",
    );

    expect(healMarketplaceDir(mpDir)).toEqual(["foo"]);
  });

  it("healMarketplaceDir is a no-op when marketplace.json is absent", () => {
    expect(healMarketplaceDir(join(tmp, "nope"))).toEqual([]);
  });

  it("healPluginCacheDir fixes the cache copy next to its plugin.json", () => {
    const versionDir = join(tmp, "cache", "postiz-agent", "postiz", "2.0.12", ".claude-plugin");
    mkdirSync(versionDir, { recursive: true });
    writeFileSync(
      join(versionDir, "marketplace.json"),
      JSON.stringify(POSTIZ_MARKETPLACE, null, 2),
      "utf8",
    );
    writeFileSync(
      join(versionDir, "plugin.json"),
      JSON.stringify(POSTIZ_PLUGIN_JSON, null, 2),
      "utf8",
    );

    const healed = healPluginCacheDir(join(tmp, "cache"));
    expect(healed).toEqual(["postiz-agent/postiz@2.0.12"]);

    const after = JSON.parse(readFileSync(join(versionDir, "marketplace.json"), "utf8"));
    expect(after.plugins[0].strict).toBe(true);
    expect(after.plugins[0].skills).toBeUndefined();

    // Idempotent
    expect(healPluginCacheDir(join(tmp, "cache"))).toEqual([]);
  });

  it("healAllMarketplaceManifests sweeps marketplaces + cache and never throws", () => {
    const mpRoot = join(tmp, "marketplaces");
    const cacheRoot = join(tmp, "cache");
    writeMarketplaceDir(join(mpRoot, "postiz-agent"));

    const healed = healAllMarketplaceManifests({
      marketplacesRoot: mpRoot,
      cacheRoot,
    });
    expect(healed).toEqual(["postiz"]);

    // Missing roots: still no throw, empty result
    expect(
      healAllMarketplaceManifests({
        marketplacesRoot: join(tmp, "missing-a"),
        cacheRoot: join(tmp, "missing-b"),
      }),
    ).toEqual([]);
  });
});
