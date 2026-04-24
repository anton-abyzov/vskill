// ---------------------------------------------------------------------------
// 0701 T-001..T-004 — server-side TDD gates:
//   T-001: resolveClaudeCodeModel helper reads ~/.claude/settings.json
//   T-002: /api/config surfaces resolvedModel on claude-cli provider
//   T-003: PROVIDER_MODELS["anthropic"] carries pricing per 1M tokens
//   T-004: /api/config surfaces per-model pricing on anthropic provider
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Mock node:os so we can control what homedir() returns.
// vi.spyOn does not work on ESM namespace objects, so we re-export with a
// hoisted stub for homedir().
// ---------------------------------------------------------------------------

const osMock = vi.hoisted(() => ({
  homedir: vi.fn<() => string>(),
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    homedir: osMock.homedir,
  };
});

function makeFakeHome(settings: unknown | null): string {
  const dir = mkdtempSync(join(tmpdir(), "vskill-0701-home-"));
  const claudeDir = join(dir, ".claude");
  mkdirSync(claudeDir, { recursive: true });
  if (settings !== null) {
    writeFileSync(
      join(claudeDir, "settings.json"),
      typeof settings === "string" ? settings : JSON.stringify(settings),
      "utf8",
    );
  }
  return dir;
}

const {
  resolveClaudeCodeModel,
  detectAvailableProviders,
  resetDetectionCache,
  PROVIDER_MODELS,
} = await import("../api-routes.js");

describe("0701 T-001: resolveClaudeCodeModel", () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    osMock.homedir.mockReset();
    for (const d of createdDirs.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  });

  it("returns the model string when ~/.claude/settings.json has a string model", () => {
    const home = makeFakeHome({ model: "claude-opus-4-7[1m]" });
    createdDirs.push(home);
    osMock.homedir.mockReturnValue(home);
    expect(resolveClaudeCodeModel()).toBe("claude-opus-4-7[1m]");
  });

  it("returns null when the file is missing", () => {
    const home = makeFakeHome(null);
    createdDirs.push(home);
    osMock.homedir.mockReturnValue(home);
    expect(resolveClaudeCodeModel()).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    const home = makeFakeHome("{ not json");
    createdDirs.push(home);
    osMock.homedir.mockReturnValue(home);
    expect(resolveClaudeCodeModel()).toBeNull();
  });

  it("returns null when model is not a string", () => {
    const home = makeFakeHome({ model: 123 });
    createdDirs.push(home);
    osMock.homedir.mockReturnValue(home);
    expect(resolveClaudeCodeModel()).toBeNull();
  });

  it("returns null when model key is absent", () => {
    const home = makeFakeHome({});
    createdDirs.push(home);
    osMock.homedir.mockReturnValue(home);
    expect(resolveClaudeCodeModel()).toBeNull();
  });
});

describe("0701 T-002: /api/config exposes resolvedModel on claude-cli", () => {
  const createdDirs: string[] = [];

  beforeEach(() => {
    resetDetectionCache();
  });

  afterEach(() => {
    osMock.homedir.mockReset();
    for (const d of createdDirs.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
    resetDetectionCache();
  });

  it("propagates the resolved model string on claude-cli provider entry", async () => {
    const home = makeFakeHome({ model: "claude-opus-4-7[1m]" });
    createdDirs.push(home);
    osMock.homedir.mockReturnValue(home);

    const providers = await detectAvailableProviders();
    const cli = providers.find((p) => p.id === "claude-cli") as
      | (typeof providers)[number] & { resolvedModel?: string | null }
      | undefined;
    expect(cli).toBeDefined();
    expect(cli!.resolvedModel).toBe("claude-opus-4-7[1m]");
  });

  it("returns resolvedModel: null when ~/.claude/settings.json is missing", async () => {
    const home = makeFakeHome(null);
    createdDirs.push(home);
    osMock.homedir.mockReturnValue(home);

    const providers = await detectAvailableProviders();
    const cli = providers.find((p) => p.id === "claude-cli") as
      | (typeof providers)[number] & { resolvedModel?: string | null }
      | undefined;
    expect(cli).toBeDefined();
    expect(cli!.resolvedModel).toBeNull();
  });

  it("reflects changes on consecutive calls (no stale caching)", async () => {
    const home = makeFakeHome({ model: "claude-sonnet-4-6" });
    createdDirs.push(home);
    osMock.homedir.mockReturnValue(home);

    let providers = await detectAvailableProviders();
    let cli = providers.find((p) => p.id === "claude-cli") as
      | (typeof providers)[number] & { resolvedModel?: string | null }
      | undefined;
    expect(cli!.resolvedModel).toBe("claude-sonnet-4-6");

    writeFileSync(
      join(home, ".claude", "settings.json"),
      JSON.stringify({ model: "claude-opus-4-7[1m]" }),
      "utf8",
    );
    resetDetectionCache();

    providers = await detectAvailableProviders();
    cli = providers.find((p) => p.id === "claude-cli") as
      | (typeof providers)[number] & { resolvedModel?: string | null }
      | undefined;
    expect(cli!.resolvedModel).toBe("claude-opus-4-7[1m]");
  });
});

describe("0701 T-003: PROVIDER_MODELS anthropic pricing map", () => {
  it("carries pricing on every anthropic entry", () => {
    const anthropic = PROVIDER_MODELS["anthropic"];
    for (const m of anthropic) {
      expect(m.pricing, `missing pricing on ${m.id}`).toBeDefined();
      expect(m.pricing!.prompt).toBeGreaterThan(0);
      expect(m.pricing!.completion).toBeGreaterThan(0);
    }
  });

  it("pins Claude Sonnet 4.6 at $3 / $15 per 1M tokens", () => {
    const entry = PROVIDER_MODELS["anthropic"].find(
      (m) => m.id === "claude-sonnet-4-6",
    );
    expect(entry?.pricing).toEqual({ prompt: 3, completion: 15 });
  });

  it("pins Claude Opus 4.7 at $5 / $25 per 1M tokens", () => {
    // 0711: refreshed from a stale 0701-era assertion that listed Opus 4.7
    // at the older Opus 4.0/4.1 price ($15/$75). Anthropic dropped Opus
    // pricing to $5/$25 with the 4.6/4.7 release on 2026-02-05 — verified
    // against https://claude.com/pricing on 2026-04-24.
    const entry = PROVIDER_MODELS["anthropic"].find(
      (m) => m.id === "claude-opus-4-7",
    );
    expect(entry?.pricing).toEqual({ prompt: 5, completion: 25 });
  });

  it("pins Claude Haiku 4.5 at $1 / $5 per 1M tokens", () => {
    const entry = PROVIDER_MODELS["anthropic"].find(
      (m) => m.id === "claude-haiku-4-5-20251001",
    );
    expect(entry?.pricing).toEqual({ prompt: 1, completion: 5 });
  });
});

describe("0701 T-004: /api/config surfaces pricing", () => {
  beforeEach(() => {
    resetDetectionCache();
    // Stable temp home; T-004 isn't about claude-cli resolution.
    osMock.homedir.mockReturnValue(mkdtempSync(join(tmpdir(), "vskill-0701-t004-")));
  });

  afterEach(() => {
    osMock.homedir.mockReset();
    resetDetectionCache();
  });

  it("every anthropic model in /api/config carries pricing", async () => {
    const providers = await detectAvailableProviders();
    const ant = providers.find((p) => p.id === "anthropic");
    expect(ant).toBeDefined();
    for (const m of ant!.models) {
      expect(
        (m as { pricing?: { prompt: number; completion: number } }).pricing,
        `missing pricing on ${m.id}`,
      ).toBeDefined();
    }
  });

  it("claude-cli models do NOT carry pricing (subscription billing)", async () => {
    const providers = await detectAvailableProviders();
    const cli = providers.find((p) => p.id === "claude-cli");
    expect(cli).toBeDefined();
    for (const m of cli!.models) {
      expect(
        (m as { pricing?: unknown }).pricing,
      ).toBeUndefined();
    }
  });
});
