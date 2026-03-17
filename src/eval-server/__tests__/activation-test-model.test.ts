import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { matchExistingPlugin } from "../skill-create-routes.js";
import type { PluginSuggestion } from "../skill-create-routes.js";

// ---------------------------------------------------------------------------
// matchExistingPlugin tests
// ---------------------------------------------------------------------------

let testRoot: string;

describe("matchExistingPlugin", () => {
  beforeEach(() => {
    testRoot = join(tmpdir(), `vskill-match-${Date.now()}`);
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  function createPlugin(name: string, skills: Array<{ name: string; desc: string; tags: string[] }>) {
    for (const skill of skills) {
      const skillDir = join(testRoot, name, "skills", skill.name);
      mkdirSync(skillDir, { recursive: true });
      const frontmatter = [
        "---",
        `name: ${skill.name}`,
        `description: "${skill.desc}"`,
        `tags: ${skill.tags.join(", ")}`,
        "---",
        "",
        `# /${skill.name}`,
      ].join("\n");
      writeFileSync(join(skillDir, "SKILL.md"), frontmatter, "utf-8");
    }
  }

  it("returns high-confidence match when tags overlap strongly", () => {
    createPlugin("testing", [
      { name: "run-tests", desc: "Run automated test suites", tags: ["testing", "eval", "automation"] },
    ]);
    createPlugin("marketing", [
      { name: "write-copy", desc: "Generate marketing copy", tags: ["marketing", "content"] },
    ]);

    const result = matchExistingPlugin(
      "test-runner",
      "run unit and integration tests",
      ["testing", "eval"],
      testRoot,
    );

    expect(result).not.toBeNull();
    expect(result!.plugin).toBe("testing");
    expect(result!.confidence).toBe("high");
  });

  it("returns medium-confidence match for partial overlap", () => {
    createPlugin("google-workspace", [
      { name: "gmail-send", desc: "Send emails via Gmail API", tags: ["google", "email"] },
    ]);

    const result = matchExistingPlugin(
      "drive-upload",
      "Upload files to Google Drive",
      ["google"],
      testRoot,
    );

    expect(result).not.toBeNull();
    expect(result!.plugin).toBe("google-workspace");
  });

  it("returns null when no plugins match", () => {
    createPlugin("testing", [
      { name: "run-tests", desc: "Run test suites", tags: ["testing"] },
    ]);

    const result = matchExistingPlugin(
      "recipe-finder",
      "Find and suggest cooking recipes",
      ["cooking", "food", "recipes"],
      testRoot,
    );

    expect(result).toBeNull();
  });

  it("returns null when no plugins exist", () => {
    const result = matchExistingPlugin(
      "my-skill",
      "Some description",
      ["tag1"],
      testRoot,
    );

    expect(result).toBeNull();
  });

  it("matches by plugin name similarity", () => {
    createPlugin("browser-automation", [
      { name: "click-element", desc: "Click web page elements", tags: ["browser"] },
    ]);

    const result = matchExistingPlugin(
      "browser-screenshot",
      "Take screenshots of web pages",
      [],
      testRoot,
    );

    expect(result).not.toBeNull();
    expect(result!.plugin).toBe("browser-automation");
  });

  it("picks the best match among multiple plugins", () => {
    createPlugin("marketing", [
      { name: "write-copy", desc: "Generate marketing copy", tags: ["marketing", "content", "seo"] },
    ]);
    createPlugin("testing", [
      { name: "run-tests", desc: "Run test suites", tags: ["testing", "qa"] },
    ]);

    const result = matchExistingPlugin(
      "seo-analyzer",
      "Analyze SEO quality of content",
      ["seo", "content", "marketing"],
      testRoot,
    );

    expect(result).not.toBeNull();
    expect(result!.plugin).toBe("marketing");
  });
});
