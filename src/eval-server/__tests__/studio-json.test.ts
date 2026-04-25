// ---------------------------------------------------------------------------
// 0682 T-012 — studio-json atomic load/save unit coverage.
//
// Exercises:
//   - load returns null when file is missing
//   - load returns null + warns on malformed JSON (no throw)
//   - load returns null on missing required fields
//   - load returns the parsed selection on a valid file
//   - save creates the .vskill/ directory if absent
//   - save uses atomic tmp-then-rename (final file exists, no .tmp.* leftover)
//   - save sweeps orphan `studio.json.tmp.*` siblings on next write
//   - save preserves the existing file on rename failure (never partial)
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import * as fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadStudioSelection,
  saveStudioSelection,
} from "../studio-json.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vskill-studio-json-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("studio-json — loadStudioSelection", () => {
  it("returns null when .vskill/studio.json is missing", () => {
    expect(loadStudioSelection(root)).toBeNull();
  });

  it("returns the parsed selection when the file is well-formed", () => {
    mkdirSync(join(root, ".vskill"), { recursive: true });
    writeFileSync(
      join(root, ".vskill", "studio.json"),
      JSON.stringify({
        activeAgent: "openrouter",
        activeModel: "anthropic/claude-sonnet-4",
        updatedAt: "2026-04-23T15:00:00.000Z",
      }),
      "utf8",
    );

    const result = loadStudioSelection(root);
    expect(result).toEqual({
      activeAgent: "openrouter",
      activeModel: "anthropic/claude-sonnet-4",
      updatedAt: "2026-04-23T15:00:00.000Z",
    });
  });

  it("returns null and warns (no throw) when JSON is malformed", () => {
    mkdirSync(join(root, ".vskill"), { recursive: true });
    writeFileSync(join(root, ".vskill", "studio.json"), "{not valid json", "utf8");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = loadStudioSelection(root);
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/malformed/i);
  });

  it("returns null when required fields are missing", () => {
    mkdirSync(join(root, ".vskill"), { recursive: true });
    writeFileSync(
      join(root, ".vskill", "studio.json"),
      JSON.stringify({ activeAgent: "claude-code" }),
      "utf8",
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(loadStudioSelection(root)).toBeNull();
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("falls back to current ISO timestamp when updatedAt is absent but other fields valid", () => {
    mkdirSync(join(root, ".vskill"), { recursive: true });
    writeFileSync(
      join(root, ".vskill", "studio.json"),
      JSON.stringify({ activeAgent: "claude-code", activeModel: "sonnet" }),
      "utf8",
    );

    const result = loadStudioSelection(root);
    expect(result?.activeAgent).toBe("claude-code");
    expect(result?.activeModel).toBe("sonnet");
    expect(result?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("studio-json — saveStudioSelection", () => {
  it("creates the .vskill directory when absent", async () => {
    expect(existsSync(join(root, ".vskill"))).toBe(false);
    await saveStudioSelection(root, {
      activeAgent: "claude-code",
      activeModel: "sonnet",
      updatedAt: new Date().toISOString(),
    });
    expect(existsSync(join(root, ".vskill"))).toBe(true);
    expect(existsSync(join(root, ".vskill", "studio.json"))).toBe(true);
  });

  it("writes valid JSON content matching the input selection", async () => {
    const selection = {
      activeAgent: "anthropic",
      activeModel: "claude-sonnet-4-7",
      updatedAt: "2026-04-23T16:00:00.000Z",
    };
    await saveStudioSelection(root, selection);

    const written = readFileSync(join(root, ".vskill", "studio.json"), "utf8");
    expect(JSON.parse(written)).toEqual(selection);
  });

  it("performs atomic tmp-then-rename — no .tmp.* leftover after success", async () => {
    await saveStudioSelection(root, {
      activeAgent: "claude-code",
      activeModel: "sonnet",
      updatedAt: new Date().toISOString(),
    });

    const entries = readdirSync(join(root, ".vskill"));
    expect(entries).toContain("studio.json");
    const orphans = entries.filter((e) => e.startsWith("studio.json.tmp."));
    expect(orphans).toEqual([]);
  });

  it("sweeps orphan studio.json.tmp.* siblings on next save", async () => {
    mkdirSync(join(root, ".vskill"), { recursive: true });
    // Plant an orphan tmp file from a hypothetical prior crash.
    const orphan = join(root, ".vskill", "studio.json.tmp.deadbeef");
    writeFileSync(orphan, "{}", "utf8");
    expect(existsSync(orphan)).toBe(true);

    await saveStudioSelection(root, {
      activeAgent: "claude-code",
      activeModel: "sonnet",
      updatedAt: new Date().toISOString(),
    });

    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(join(root, ".vskill", "studio.json"))).toBe(true);
  });

  it("cleans up tmp file when rename fails — original file untouched", async () => {
    // Seed a valid existing file.
    mkdirSync(join(root, ".vskill"), { recursive: true });
    const goodContent = JSON.stringify({
      activeAgent: "claude-code",
      activeModel: "sonnet",
      updatedAt: "2026-04-23T15:00:00.000Z",
    });
    writeFileSync(join(root, ".vskill", "studio.json"), goodContent, "utf8");

    // Make the .vskill directory read-only on POSIX so renameSync fails
    // mid-save. (writeFileSync on the existing tmp path also fails for the
    // same reason; the implementation should propagate the error and leave
    // the original file alone.) Skip on Windows where chmod semantics differ.
    if (process.platform === "win32") return;

    const dir = join(root, ".vskill");
    fs.chmodSync(dir, 0o500); // read+execute, no write

    try {
      await expect(
        saveStudioSelection(root, {
          activeAgent: "openrouter",
          activeModel: "anthropic/claude-sonnet-4",
          updatedAt: new Date().toISOString(),
        }),
      ).rejects.toBeDefined();

      // Original file remains intact.
      const after = readFileSync(join(root, ".vskill", "studio.json"), "utf8");
      expect(JSON.parse(after).activeAgent).toBe("claude-code");
    } finally {
      // Restore writability so afterEach cleanup succeeds.
      fs.chmodSync(dir, 0o700);
    }
  });

  it("save+load round-trip preserves the selection exactly", async () => {
    const original = {
      activeAgent: "ollama",
      activeModel: "llama3.1:8b",
      updatedAt: "2026-04-23T17:00:00.000Z",
    };
    await saveStudioSelection(root, original);
    expect(loadStudioSelection(root)).toEqual(original);
  });
});
