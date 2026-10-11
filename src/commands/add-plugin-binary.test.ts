import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectPluginContent } from "./add.js";
import { runTier1Scan } from "../scanner/index.js";

// A 19-byte GIF from a real plugin; its bytes decode to Unicode tag characters.
const GIF = Buffer.from("474946383961000102f3a08182f3a081830900", "hex");

describe("collectPluginContent skips binary files", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("leaves image bytes out of the scanned text, so the plugin is not failed for them", () => {
    dir = mkdtempSync(join(tmpdir(), "vskill-plugin-"));
    mkdirSync(join(dir, "skills", "demo"), { recursive: true });
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: demo\n---\n# Demo\n");
    writeFileSync(join(dir, "assets", "tiny.gif"), GIF);

    const content = collectPluginContent(dir);
    expect(content).toContain("SKILL.md");
    expect(content).not.toContain("tiny.gif");
    expect(runTier1Scan(content).verdict).toBe("PASS");
  });
});
