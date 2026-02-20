import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadAuditConfig } from "./config.js";

describe("config", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "vskill-config-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("TC-050: returns defaults when no config file exists", async () => {
    const config = await loadAuditConfig(tmpDir, {});

    expect(config.excludePaths).toEqual([]);
    expect(config.maxFiles).toBe(500);
    expect(config.severityThreshold).toBe("low");
    expect(config.tier1Only).toBe(false);
    expect(config.fix).toBe(false);
  });

  it("TC-051: loads and merges .vskill-audit.json", async () => {
    await writeFile(
      join(tmpDir, ".vskill-audit.json"),
      JSON.stringify({ excludePaths: ["vendor/"], maxFiles: 200 }),
    );

    const config = await loadAuditConfig(tmpDir, {});

    expect(config.excludePaths).toEqual(["vendor/"]);
    expect(config.maxFiles).toBe(200);
    // Other fields remain defaults
    expect(config.severityThreshold).toBe("low");
  });

  it("TC-052: CLI flags override config file values", async () => {
    await writeFile(
      join(tmpDir, ".vskill-audit.json"),
      JSON.stringify({ maxFiles: 100 }),
    );

    const config = await loadAuditConfig(tmpDir, { maxFiles: "50" });

    expect(config.maxFiles).toBe(50);
  });

  it("TC-053: invalid severity value throws error", async () => {
    await expect(
      loadAuditConfig(tmpDir, { severity: "invalid" }),
    ).rejects.toThrow();
  });

  it("loads .vskillrc as fallback", async () => {
    await writeFile(
      join(tmpDir, ".vskillrc"),
      JSON.stringify({ tier1Only: true }),
    );

    const config = await loadAuditConfig(tmpDir, {});

    expect(config.tier1Only).toBe(true);
  });
});
