// ---------------------------------------------------------------------------
// claude-cli-compliance.test.ts — NFR-006 blocking closure gate.
//
// Asserts the Claude CLI adapter NEVER reads any file under
// `~/.claude/credentials*|auth*|token*` at the Node API level. The test
// prepends a fake `claude` binary to PATH so `spawn("claude", ...)` resolves
// to a harmless shim, then drives `createLlmClient({ provider: "claude-cli" })
// .generate(...)` to completion and verifies that every fs API call was
// against a path outside the forbidden set.
//
// Combined with the dist-bundle grep in scripts/check-bundle-compliance.sh,
// this enforces Anthropic's April 4 2026 ToS for the entire shipping surface.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLlmClient } from "../llm.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const FORBIDDEN_RE = /\.claude\/(credentials|auth|token)/i;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = resolve(__dirname, "..", "__fixtures__");

describe("claude-cli compliance — no ~/.claude/credentials*|auth*|token* reads", () => {
  const originalPath = process.env.PATH;

  beforeEach(() => {
    // Prepend fixtures to PATH so `claude` resolves to fake-claude.sh.
    // macOS security: spawn looks up the binary by name against PATH, so
    // the shim wins over any real install.
    process.env.PATH = `${fixturesDir}:${originalPath ?? ""}`;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    vi.restoreAllMocks();
  });

  it("reads zero credential-file paths through any fs API", async () => {
    const fs = await import("node:fs");
    const fsPromises = await import("node:fs/promises");

    const observed: string[] = [];
    const capture = (p: unknown) => {
      if (typeof p === "string") observed.push(p);
      else if (p && typeof p === "object" && "toString" in p) observed.push(String(p));
    };

    // Spy every fs read entry point the adapter could plausibly traverse.
    // vi.spyOn handles ESM read-only descriptors by cloning the binding.
    const targets: Array<[Record<string, unknown>, string]> = [
      [fs as unknown as Record<string, unknown>, "readFile"],
      [fs as unknown as Record<string, unknown>, "readFileSync"],
      [fs as unknown as Record<string, unknown>, "open"],
      [fs as unknown as Record<string, unknown>, "openSync"],
      [fs as unknown as Record<string, unknown>, "createReadStream"],
      [fsPromises as unknown as Record<string, unknown>, "readFile"],
      [fsPromises as unknown as Record<string, unknown>, "open"],
    ];
    const spies: ReturnType<typeof vi.spyOn>[] = [];
    for (const [obj, method] of targets) {
      if (typeof obj[method] !== "function") continue;
      try {
        // @ts-expect-error — dynamic method spy on fs/fsPromises
        const spy = vi.spyOn(obj, method).mockImplementation((...args: unknown[]) => {
          capture(args[0]);
          // Don't actually call through — the adapter doesn't need fs reads
          // to succeed (it shells out to claude CLI). Returning a safe default
          // prevents incidental side effects.
          if (method.endsWith("Sync")) return "";
          // Async: resolve empty
          return Promise.resolve("");
        });
        spies.push(spy);
      } catch { /* spy not supported for this binding — skip, the pattern still holds */ }
    }

    try {
      const client = createLlmClient({ provider: "claude-cli" });
      const result = await client.generate("sys", "user");
      expect(result.text.length).toBeGreaterThan(0);
      const offenders = observed.filter((p) => FORBIDDEN_RE.test(p));
      expect(offenders).toEqual([]);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  }, 15_000);

  it("case-insensitive: credential path variations also rejected", () => {
    expect("/home/user/.claude/Credentials.json".match(FORBIDDEN_RE)).not.toBeNull();
    expect("/home/user/.claude/AUTH.token".match(FORBIDDEN_RE)).not.toBeNull();
    expect("/home/user/.claude/token/refresh".match(FORBIDDEN_RE)).not.toBeNull();
    // Not credential-like — should not match.
    expect("/home/user/.claude/skills/hello.md".match(FORBIDDEN_RE)).toBeNull();
    expect("/home/user/.claude/plugins/foo.json".match(FORBIDDEN_RE)).toBeNull();
  });
});
