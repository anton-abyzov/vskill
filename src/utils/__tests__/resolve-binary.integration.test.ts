/**
 * Integration tests for resolve-binary.ts
 * These test against the REAL filesystem and PATH, not mocks.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

// Import the REAL module (no mocks)
import { resolveCliBinary, enhancedPath, clearResolveCache } from "../resolve-binary.js";

describe("resolveCliBinary integration", () => {
  beforeEach(() => {
    clearResolveCache();
  });

  it("resolves 'node' to an absolute path that exists", () => {
    const resolved = resolveCliBinary("node");
    expect(resolved).toMatch(/^\//); // absolute path on Unix
    expect(existsSync(resolved)).toBe(true);
  });

  it("resolved 'node' is actually executable", () => {
    const resolved = resolveCliBinary("node");
    const version = execSync(`"${resolved}" --version`, { timeout: 5_000 }).toString().trim();
    expect(version).toMatch(/^v\d+/);
  });

  it("resolves 'npm' to an absolute path that exists", () => {
    const resolved = resolveCliBinary("npm");
    expect(resolved).toMatch(/^\//);
    expect(existsSync(resolved)).toBe(true);
  });

  it("returns bare name for nonexistent binary", () => {
    const resolved = resolveCliBinary("totally-fake-binary-xyz-12345");
    // Should fall through all strategies and return the bare name
    expect(resolved).toBe("totally-fake-binary-xyz-12345");
  });

  it("caches results (second call is instant)", () => {
    clearResolveCache();
    const t1 = Date.now();
    const first = resolveCliBinary("node");
    const d1 = Date.now() - t1;

    const t2 = Date.now();
    const second = resolveCliBinary("node");
    const d2 = Date.now() - t2;

    expect(first).toBe(second);
    // Cached call should be <1ms (no execSync)
    expect(d2).toBeLessThan(5);
  });

  it("resolves different binaries to different paths", () => {
    const node = resolveCliBinary("node");
    const npm = resolveCliBinary("npm");
    // They should be different files
    expect(node).not.toBe(npm);
    expect(node).toContain("node");
    expect(npm).toContain("npm");
  });
});

describe("enhancedPath integration", () => {
  it("returns a string containing the original PATH", () => {
    const original = "/usr/bin:/bin";
    const enhanced = enhancedPath(original);
    expect(enhanced).toContain(original);
  });

  it("adds at least one extra directory on macOS/Linux", () => {
    if (process.platform === "win32") return; // skip on Windows

    const original = "/just/one/dir";
    const enhanced = enhancedPath(original);
    const parts = enhanced.split(":");
    // Should have more than 1 part (the original + at least 1 extra)
    expect(parts.length).toBeGreaterThan(1);
  });

  it("all added directories actually exist on disk", () => {
    const original = "/just/one/dir";
    const enhanced = enhancedPath(original);
    const parts = enhanced.split(":");
    // Skip the first part (our fake original)
    const added = parts.slice(1);
    for (const dir of added) {
      expect(existsSync(dir)).toBe(true);
    }
  });

  it("does not duplicate paths", () => {
    const enhanced = enhancedPath(process.env.PATH);
    const parts = enhanced.split(":");
    const unique = new Set(parts);
    expect(parts.length).toBe(unique.size);
  });

  it("uses process.env.PATH when no argument provided", () => {
    const enhanced = enhancedPath();
    expect(enhanced).toContain(process.env.PATH!.split(":")[0]);
  });
});

describe("end-to-end: spawn with resolved binary", () => {
  it("can spawn a resolved binary and get output", async () => {
    const { spawn } = await import("node:child_process");
    const resolved = resolveCliBinary("node");

    const output = await new Promise<string>((resolve, reject) => {
      const proc = spawn(resolved, ["-e", "console.log('hello from resolved')"], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PATH: enhancedPath() },
      });
      let stdout = "";
      proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      proc.on("close", (code) => {
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(`exit code ${code}`));
      });
      proc.on("error", reject);
    });

    expect(output).toBe("hello from resolved");
  });

  it("spawn with enhanced PATH can find binaries even with minimal PATH", async () => {
    const { spawn } = await import("node:child_process");
    const resolved = resolveCliBinary("node");

    // Simulate a minimal PATH that doesn't include node's directory
    const output = await new Promise<string>((resolve, reject) => {
      const proc = spawn(resolved, ["-e", "console.log(process.env.PATH)"], {
        stdio: ["pipe", "pipe", "pipe"],
        // Give it a minimal PATH but enhance it
        env: { PATH: enhancedPath("/tmp") },
      });
      let stdout = "";
      proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      proc.on("close", (code) => {
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(`exit code ${code}`));
      });
      proc.on("error", reject);
    });

    // The enhanced PATH should include common dirs
    expect(output).toContain("/tmp");
    // Should also include at least one more directory
    expect(output.split(":").length).toBeGreaterThan(1);
  });
});
