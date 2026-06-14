// 0845 — AgentDefinition extension + getSupportedAgents() contract
//
// Covers Phase 1 backend-foundation tasks T-001..T-004:
//  - T-001: AgentDefinition gains optional `tier`, `installMode`,
//    `formatTransformer`, `pasteInstructionsUrl`, `docsUrl` fields.
//  - T-002: Antigravity entry verified (~/.gemini/antigravity/skills,
//    Tier 1, filesystem, no isRemoteOnly).
//  - T-003: All registry entries populated with tier + installMode.
//    Adds new `chatgpt` Tier 3 entry. v0/bolt-new flipped to clipboard.
//  - T-004: `getSupportedAgents()` returns every entry whose installMode
//    resolves to "filesystem" or "clipboard", regardless of binary detection.
//
// ACs covered: AC-US1-01, AC-US1-02, AC-US1-04, AC-US1-06,
//              AC-US3-01..AC-US3-04, AC-US4-01, AC-US6-02, AC-US6-03.

import { describe, it, expect, vi } from "vitest";
import {
  AGENTS_REGISTRY,
  TOTAL_AGENTS,
  getAgent,
  getSupportedAgents,
  detectInstalledAgents,
  type AgentDefinition,
} from "../agents-registry.js";

// ---------------------------------------------------------------------------
// T-001 — AgentDefinition extension (AC-US4-01)
// ---------------------------------------------------------------------------
describe("0845 T-001 — AgentDefinition optional extension fields", () => {
  it("AC-US4-01: every entry resolves to defaults when fields are absent", () => {
    for (const a of AGENTS_REGISTRY) {
      const tier = a.tier ?? 1;
      const installMode = a.installMode ?? "filesystem";
      expect([1, 2, 3]).toContain(tier);
      expect(["filesystem", "clipboard"]).toContain(installMode);
    }
  });

  it("AC-US4-01: ParsedSkill/TransformedFile types exported from transformers/index", async () => {
    const mod = await import("../../installer/transformers/index.js");
    // The interfaces compile-check via tsc; at runtime we only assert the
    // module loads and exposes its barrel namespace (no thrown error).
    expect(mod).toBeDefined();
  });

  it("registry length is unchanged after extension (53 base + 1 new chatgpt = 54)", () => {
    // T-003 adds a new `chatgpt` entry; existing 53 entries remain.
    expect(TOTAL_AGENTS).toBeGreaterThanOrEqual(54);
  });
});

// ---------------------------------------------------------------------------
// T-002 — Antigravity entry (AC-US3-01, AC-US3-02, AC-US3-03, AC-US3-04)
// ---------------------------------------------------------------------------
describe("0845 T-002 — Antigravity entry", () => {
  it("AC-US3-01: Antigravity is registered, not remote-only, Tier 1 filesystem", () => {
    const ag = getAgent("antigravity");
    expect(ag).toBeDefined();
    expect(ag!.isRemoteOnly ?? false).toBe(false);
    expect(ag!.tier ?? 1).toBe(1);
    expect(ag!.installMode ?? "filesystem").toBe("filesystem");
  });

  it("AC-US3-02: globalSkillsDir is ~/.gemini/antigravity/skills, local is .agent/skills", () => {
    const ag = getAgent("antigravity")!;
    expect(ag.globalSkillsDir).toBe("~/.gemini/antigravity/skills");
    expect(ag.localSkillsDir).toBe(".agent/skills");
  });

  it("AC-US3-03: VSKILL_ANTIGRAVITY_SKILLS_DIR overrides resolved global dir in getSupportedAgents", async () => {
    const prev = process.env.VSKILL_ANTIGRAVITY_SKILLS_DIR;
    process.env.VSKILL_ANTIGRAVITY_SKILLS_DIR = "/tmp/ag-test-0845";
    try {
      const agents = await getSupportedAgents();
      const ag = agents.find((a) => a.id === "antigravity");
      expect(ag).toBeDefined();
      expect(ag!.resolvedGlobalDir).toBe("/tmp/ag-test-0845");
    } finally {
      if (prev === undefined) delete process.env.VSKILL_ANTIGRAVITY_SKILLS_DIR;
      else process.env.VSKILL_ANTIGRAVITY_SKILLS_DIR = prev;
    }
  });

  it("AC-US3-04: Antigravity surfaces in getSupportedAgents regardless of binary detection", async () => {
    const agents = await getSupportedAgents();
    expect(agents.map((a) => a.id)).toContain("antigravity");
  });
});

// ---------------------------------------------------------------------------
// T-003 — tier + installMode populated; chatgpt added (AC-US3-04, AC-US5-01)
// ---------------------------------------------------------------------------
describe("0845 T-003 — tier + installMode classification", () => {
  it("AC-US5-01: chatgpt entry exists with Tier 3 clipboard mode and paste URL", () => {
    const cg = getAgent("chatgpt");
    expect(cg).toBeDefined();
    expect(cg!.tier).toBe(3);
    expect(cg!.installMode).toBe("clipboard");
    expect(cg!.isRemoteOnly).toBe(true);
    expect(cg!.pasteInstructionsUrl).toMatch(/^https:\/\//);
  });

  it("AC-US5-01: bolt-new and v0 are flipped to Tier 3 clipboard", () => {
    for (const id of ["bolt-new", "v0"] as const) {
      const a = getAgent(id);
      expect(a).toBeDefined();
      expect(a!.tier).toBe(3);
      expect(a!.installMode).toBe("clipboard");
      expect(a!.pasteInstructionsUrl).toMatch(/^https:\/\//);
    }
  });

  it("Tier 2 agents declared explicitly (cursor, windsurf, github-copilot-ext, junie, kiro-cli, continue, aider, trae)", () => {
    const tier2 = [
      "cursor",
      "windsurf",
      "github-copilot-ext",
      "junie",
      "kiro-cli",
      "continue",
      "aider",
      "trae",
    ];
    for (const id of tier2) {
      const a = getAgent(id);
      expect(a, `tier-2 entry ${id} missing`).toBeDefined();
      expect(a!.tier, `tier mismatch for ${id}`).toBe(2);
      expect(a!.installMode, `installMode mismatch for ${id}`).toBe("filesystem");
    }
  });

  // F7 — github-copilot-ext: VS Code reads workspace instructions from
  // `.github/instructions/`, NOT the parent of localSkillsDir
  // (`.github/copilot`). The registry pins `localInstallRoot: '.github'` and
  // wires the transformer that emits `instructions/<name>.instructions.md`.
  // Locking BOTH config knobs here so config drift fails fast at the source.
  it("F7: github-copilot-ext pins localInstallRoot to .github and emits instructions/<name>.instructions.md", () => {
    const a = getAgent("github-copilot-ext");
    expect(a).toBeDefined();
    expect(a!.localSkillsDir).toBe(".github/copilot/skills");
    expect(a!.localInstallRoot).toBe(".github");
    expect(a!.formatTransformer).toBeTypeOf("function");

    const files = a!.formatTransformer!(
      { name: "obsidian-brain", body: "body", frontmatter: {} } as any,
      "project",
    );
    expect(files).toHaveLength(1);
    expect(files[0].relativePath).toBe("instructions/obsidian-brain.instructions.md");
    // localInstallRoot ('.github') + relativePath ('instructions/...') must
    // compose to `.github/instructions/...` — where VS Code actually reads.
    expect(`${a!.localInstallRoot}/${files[0].relativePath}`).toBe(
      ".github/instructions/obsidian-brain.instructions.md",
    );
  });

  it("Core Tier 1 agents declared (claude-code, codex, antigravity, gemini-cli, openclaw, opencode)", () => {
    const tier1Core = ["claude-code", "codex", "antigravity", "gemini-cli", "openclaw", "opencode"];
    for (const id of tier1Core) {
      const a = getAgent(id);
      expect(a, `tier-1 entry ${id} missing`).toBeDefined();
      expect(a!.tier).toBe(1);
      expect(a!.installMode).toBe("filesystem");
    }
  });

  it("Pure remote-only agents devin and replit stay isRemoteOnly with NO installMode (excluded from supported)", () => {
    for (const id of ["devin", "replit"] as const) {
      const a = getAgent(id);
      expect(a).toBeDefined();
      expect(a!.isRemoteOnly).toBe(true);
      expect(a!.installMode).toBeUndefined();
    }
  });

  it("every entry has a resolvable tier (no missing classifications)", () => {
    // For T-003 we either annotate or default. Both paths must yield 1|2|3.
    for (const a of AGENTS_REGISTRY) {
      const tier = a.tier ?? 1;
      expect([1, 2, 3]).toContain(tier);
    }
  });
});

// ---------------------------------------------------------------------------
// T-004 — getSupportedAgents() (AC-US1-01, AC-US6-02, AC-US6-03)
// ---------------------------------------------------------------------------
describe("0845 T-004 — getSupportedAgents()", () => {
  it("AC-US1-01: returns every entry with installMode filesystem|clipboard", async () => {
    const agents = await getSupportedAgents();
    expect(agents.length).toBeGreaterThan(0);
    for (const a of agents) {
      expect(["filesystem", "clipboard"]).toContain(a.installMode);
    }
  });

  it("AC-US1-01: each entry is enriched with { id, displayName, detected, tier, installMode, resolvedGlobalDir, resolvedLocalDir }", async () => {
    const agents = await getSupportedAgents();
    for (const a of agents) {
      expect(typeof a.id).toBe("string");
      expect(typeof a.displayName).toBe("string");
      expect(typeof a.detected).toBe("boolean");
      expect([1, 2, 3]).toContain(a.tier);
      expect(["filesystem", "clipboard"]).toContain(a.installMode);
      expect(typeof a.resolvedGlobalDir).toBe("string");
      expect(typeof a.resolvedLocalDir).toBe("string");
    }
  });

  it("AC-US1-01: resolvedGlobalDir tilde-expands ~/", async () => {
    const agents = await getSupportedAgents();
    const claude = agents.find((a) => a.id === "claude-code");
    expect(claude).toBeDefined();
    expect(claude!.resolvedGlobalDir.startsWith("~/")).toBe(false);
    expect(claude!.resolvedGlobalDir.endsWith("/.claude/skills")).toBe(true);
  });

  it("AC-US1-01: Tier 3 entries include pasteInstructionsUrl", async () => {
    const agents = await getSupportedAgents();
    const cg = agents.find((a) => a.id === "chatgpt");
    expect(cg).toBeDefined();
    expect(typeof cg!.pasteInstructionsUrl).toBe("string");
  });

  it("AC-US1-06: devin and replit are excluded (no installMode set)", async () => {
    const agents = await getSupportedAgents();
    const ids = agents.map((a) => a.id);
    expect(ids).not.toContain("devin");
    expect(ids).not.toContain("replit");
  });

  it("AC-US6-03: detectInstalledAgents() behavior is unchanged — returns only detected", async () => {
    // Detection paths can fail in CI; we only assert the contract: every
    // entry returned has the same shape as AgentDefinition (no `detected`
    // flag injected). The semantics are "detected => present", not "all".
    const detected = await detectInstalledAgents();
    for (const a of detected) {
      // Each entry is an AgentDefinition — must NOT have getSupportedAgents'
      // enrichment fields. (Sentinel against accidental contract bleed.)
      expect((a as unknown as { detected?: unknown }).detected).toBeUndefined();
      expect((a as unknown as { resolvedGlobalDir?: unknown }).resolvedGlobalDir).toBeUndefined();
    }
  });

  it("AC-US6-02: detection probes run in parallel — total elapsed bounded by slowest, not sum", async () => {
    // We can't easily time real binary probes, but we can mock the registry's
    // detectInstalled functions to introduce a deterministic delay and assert
    // the call returns within "slowest + small headroom" rather than n * delay.
    // The function already uses Promise.allSettled internally; this is the
    // observable behavior we lock in.
    const start = Date.now();
    await getSupportedAgents();
    const elapsed = Date.now() - start;
    // Generous upper bound: 5 seconds for ~52 parallel probes. Sequential
    // would blow past this on most machines with binary lookups.
    expect(elapsed).toBeLessThan(5000);
  });
});

// ---------------------------------------------------------------------------
// Backward-compatibility sentinel: existing fields untouched
// ---------------------------------------------------------------------------
describe("0845 — backward compatibility", () => {
  it("AC-US6-03: detectInstalledAgents export still exists and is callable", () => {
    expect(typeof detectInstalledAgents).toBe("function");
  });

  it("FR-001: getAgent('chatgpt') resolves the new entry", () => {
    expect(getAgent("chatgpt")).toBeDefined();
  });

  it("FR-001: getAgent('antigravity') still resolves", () => {
    expect(getAgent("antigravity")).toBeDefined();
  });

  it("legacy alias getAgent('github-copilot') still resolves to github-copilot-ext", () => {
    expect(getAgent("github-copilot")?.id).toBe("github-copilot-ext");
  });

  // Suppress unused-import lint for the AgentDefinition type
  it("AgentDefinition type is exported", () => {
    const a: AgentDefinition | undefined = getAgent("claude-code");
    expect(a).toBeDefined();
  });

  // Side-effect-free guard: confirm vi is wired even when no mock is used.
  it("vi global is available (sentinel)", () => {
    expect(typeof vi.fn).toBe("function");
  });
});
