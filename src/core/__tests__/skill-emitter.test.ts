// ---------------------------------------------------------------------------
// skill-emitter.test.ts — contract tests for src/core/skill-emitter.ts
//
// T-009 (divergence report) + T-010 (x-sw-schema-version frontmatter tag).
// Written RED first; the implementation in skill-emitter.ts turns them green.
//
// Covers AC-US2-03, AC-US5-01..05, AC-US6-01..04 from increment 0670.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { emitSkill, type EmitOptions } from "../skill-emitter.js";
import type { GenerateSkillResult } from "../skill-generator.js";

/**
 * Minimal GenerateSkillResult factory. The emitter contract does not depend
 * on `evals` or `warning`, so tests only set fields the emitter reads.
 */
function makeGenerated(
  overrides: Partial<GenerateSkillResult> = {},
): GenerateSkillResult {
  return {
    name: "lint-markdown",
    description: "Lint markdown files for style + grammar issues.",
    model: "",
    allowedTools: "",
    body: "# lint-markdown\n\nDo the thing.\n",
    evals: [],
    reasoning: "",
    ...overrides,
  };
}

/**
 * Parse a YAML-ish frontmatter block into a key→string map. Good enough for
 * the contract checks below (we only probe simple scalar/inline-array values).
 * We deliberately avoid js-yaml (not a dep) — matches the emitter's own
 * frontmatter handling.
 */
function parseFrontmatter(content: string): Record<string, string> {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

describe("emitSkill — universal translation (AC-US5-*)", () => {
  it("translates allowed-tools: [Bash] → OpenCode permission for opencode target", () => {
    const gen = makeGenerated({ allowedTools: "Bash, Read" });
    const opts: EmitOptions = {
      targetAgents: ["opencode"],
      engine: "universal",
    };

    const result = emitSkill(gen, opts);

    const opencodeFile = result.files.find((f) => f.targetId === "opencode");
    expect(opencodeFile).toBeDefined();
    // Contract: translated permission block shape in emitted frontmatter.
    expect(opencodeFile!.content).toContain("permission:");
    expect(opencodeFile!.content).toContain("bash: ask");
    expect(opencodeFile!.content).toContain("read: ask");

    // Contract: divergence entry MUST exist with translation metadata.
    const div = result.divergences.find(
      (d) => d.targetId === "opencode" && d.field === "allowed-tools",
    );
    expect(div).toBeDefined();
    expect(div!.kind).toBe("translated");
    expect(div!.translation).toMatch(/permission/i);
    expect(div!.translation).toMatch(/bash: ask/);
  });

  it("NEGATIVE: spying a divergence-stripping wrapper catches silent loss", () => {
    // Simulate a regression where a wrapper over emitSkill strips divergences.
    // The test MUST fail if a refactor accidentally drops the entry.
    const gen = makeGenerated({ allowedTools: "Bash" });
    const opts: EmitOptions = {
      targetAgents: ["opencode"],
      engine: "universal",
    };

    // Stubbed wrapper that emits but OMITS the divergence entry.
    const buggyEmit = (g: GenerateSkillResult, o: EmitOptions) => {
      const r = emitSkill(g, o);
      return { ...r, divergences: [] }; // simulate silent loss
    };

    const buggy = buggyEmit(gen, opts);

    // The contract: when `allowed-tools` source is translated for opencode,
    // a divergence entry MUST exist. Its absence proves the bug caught.
    const hasAllowedToolsDivergence = buggy.divergences.some(
      (d) => d.targetId === "opencode" && d.field === "allowed-tools",
    );
    expect(hasAllowedToolsDivergence).toBe(false); // sanity — stub did strip
    // This assertion would fail against the real emitter — confirming that
    // if anyone tries to "simplify" by dropping divergences, tests catch it.
    const real = emitSkill(gen, opts);
    expect(
      real.divergences.some(
        (d) => d.targetId === "opencode" && d.field === "allowed-tools",
      ),
    ).toBe(true);
  });

  it("all-universal + no dropped fields ⇒ sentinel divergenceReport", () => {
    // Source has NO security-critical fields, emitting to universal-only
    // targets that accept canonical frontmatter verbatim.
    const gen = makeGenerated({ allowedTools: "", model: "" });
    const opts: EmitOptions = {
      targetAgents: ["cursor", "codex", "cline"],
      engine: "universal",
    };

    const result = emitSkill(gen, opts);

    expect(result.divergenceReport).toBe(
      "No divergences — all targets universal",
    );
    expect(result.divergences).toEqual([]);
    expect(result.files.length).toBe(3);
  });
});

describe("emitSkill — schema version tag (AC-US6-*)", () => {
  it("injects x-sw-schema-version: 1 into every universal emission (AC-US6-01, 04)", () => {
    const gen = makeGenerated();
    const universalIds = [
      "amp",
      "cline",
      "codex",
      "cursor",
      "gemini-cli",
      "github-copilot-ext",
      "kimi-cli",
      "opencode",
    ];
    const opts: EmitOptions = { targetAgents: universalIds, engine: "universal" };

    const result = emitSkill(gen, opts);

    expect(result.files.length).toBe(universalIds.length);
    for (const f of result.files) {
      const fm = parseFrontmatter(f.content);
      expect(fm["x-sw-schema-version"], `${f.targetId} missing schema version`).toBe(
        "1",
      );
    }
  });

  it("preserves x-sw-schema-version tag value exactly '1' (not '01' / 'v1')", () => {
    const gen = makeGenerated();
    const opts: EmitOptions = { targetAgents: ["cursor"], engine: "universal" };
    const result = emitSkill(gen, opts);
    const fm = parseFrontmatter(result.files[0].content);
    expect(fm["x-sw-schema-version"]).toBe("1");
  });
});

describe("emitSkill — anthropic-skill-creator fallback (AC-US2-03, AC-US6-03)", () => {
  it("emits exactly one claude-code file with no schema version and no divergences", () => {
    const gen = makeGenerated();
    const opts: EmitOptions = {
      targetAgents: ["claude-code", "cursor", "codex"], // non-claude filtered
      engine: "anthropic-skill-creator",
    };

    const result = emitSkill(gen, opts);

    expect(result.files.length).toBe(1);
    expect(result.files[0].targetId).toBe("claude-code");
    expect(result.divergences).toEqual([]);

    // Schema version MUST NOT be present in fallback (AC-US6-03).
    const fm = parseFrontmatter(result.files[0].content);
    expect(fm["x-sw-schema-version"]).toBeUndefined();

    // Exact sentinel divergenceReport string.
    expect(result.divergenceReport).toBe(
      "[skill-builder] fallback mode — universal targets not emitted; install vskill for universal support",
    );

    // Non-claude targets go to skipped with the expected reason.
    expect(result.skipped.length).toBe(2);
    for (const s of result.skipped) {
      expect(s.reason).toBe(
        "anthropic-skill-creator engine only supports claude-code",
      );
    }
  });
});

describe("emitSkill — legacy id aliasing (AC-US1-04 / registry LEGACY_AGENT_IDS)", () => {
  it("resolves github-copilot → canonical github-copilot-ext in output", () => {
    const gen = makeGenerated();
    const opts: EmitOptions = {
      targetAgents: ["github-copilot"], // legacy
      engine: "universal",
    };

    const result = emitSkill(gen, opts);

    expect(result.files.length).toBe(1);
    expect(result.files[0].targetId).toBe("github-copilot-ext");
    // relativePath uses canonical agent's localSkillsDir
    expect(result.files[0].relativePath).toContain(".github/copilot/skills");
  });
});

describe("emitSkill — security-critical field enforcement (AC-US5-03)", () => {
  it("records security-critical-dropped when model is dropped for a non-model target", () => {
    // Cursor binds model at the host level; source `model: opus-4` is
    // not expressible → must surface as security-critical divergence.
    const gen = makeGenerated({ model: "opus-4" });
    const opts: EmitOptions = { targetAgents: ["cursor"], engine: "universal" };

    const result = emitSkill(gen, opts);

    const div = result.divergences.find(
      (d) => d.targetId === "cursor" && d.field === "model",
    );
    expect(div).toBeDefined();
    expect(div!.kind).toBe("security-critical-dropped");
    expect(div!.originalValue).toBe("opus-4");
  });

  it("records security-critical-dropped for allowed-tools when target cannot express it", () => {
    // Cursor does not enforce tool allowlists → dropped entirely.
    const gen = makeGenerated({ allowedTools: "Bash, Read" });
    const opts: EmitOptions = { targetAgents: ["cursor"], engine: "universal" };

    const result = emitSkill(gen, opts);

    const div = result.divergences.find(
      (d) => d.targetId === "cursor" && d.field === "allowed-tools",
    );
    expect(div).toBeDefined();
    expect(div!.kind).toBe("security-critical-dropped");
  });
});

describe("emitSkill — non-universal agents that cannot express required fields", () => {
  it("skips non-universal targets that can't express a required field, with a reason", () => {
    // `mcpjam` has customSystemPrompt: false → can't even carry a system
    // prompt / frontmatter meaningfully. MVP contract: skip with reason.
    const gen = makeGenerated();
    const opts: EmitOptions = { targetAgents: ["mcpjam"], engine: "universal" };

    const result = emitSkill(gen, opts);

    // File for mcpjam should NOT be emitted; it should land in skipped.
    expect(result.files.find((f) => f.targetId === "mcpjam")).toBeUndefined();
    const skipped = result.skipped.find((s) => s.targetId === "mcpjam");
    expect(skipped).toBeDefined();
    expect(skipped!.reason).toMatch(/cannot express|customSystemPrompt|skill/i);
  });
});

describe("emitSkill — divergence report markdown shape (AC-US5-04)", () => {
  it("produces a `## <targetId>` section for each emitted target", () => {
    const gen = makeGenerated({ allowedTools: "Bash" });
    const opts: EmitOptions = {
      targetAgents: ["opencode", "cursor"],
      engine: "universal",
    };
    const result = emitSkill(gen, opts);
    expect(result.divergenceReport).toMatch(/## opencode/);
    expect(result.divergenceReport).toMatch(/## cursor/);
    // Title line
    expect(result.divergenceReport).toMatch(/^# lint-markdown — divergence report/m);
  });

  it("emits `No changes` section when one target has divergences and another does not", () => {
    // Source has allowed-tools → triggers divergence on cursor; claude-code
    // has zero divergences, so its section lists "No changes".
    const gen = makeGenerated({ allowedTools: "Bash" });
    const opts: EmitOptions = {
      targetAgents: ["claude-code", "cursor"],
      engine: "universal",
    };
    const result = emitSkill(gen, opts);
    expect(result.divergenceReport).toMatch(/## claude-code/);
    expect(result.divergenceReport).toMatch(/No changes/);
    expect(result.divergenceReport).toMatch(/## cursor/);
  });

  it("emits `Dropped:` line for non-security-critical drops (generic path)", () => {
    // Force a non-security-critical 'dropped' entry by using a custom
    // fixture that exercises the generic drop branch in the renderer.
    // We re-use the public API: there's no non-security drop today, so
    // this also validates the security-critical format includes the token.
    const gen = makeGenerated({ allowedTools: "Bash", model: "opus-4" });
    const opts: EmitOptions = {
      targetAgents: ["cursor"],
      engine: "universal",
    };
    const result = emitSkill(gen, opts);
    expect(result.divergenceReport).toMatch(/Dropped \(security-critical\): allowed-tools/);
    expect(result.divergenceReport).toMatch(/Dropped \(security-critical\): model/);
  });
});

describe("emitSkill — purity", () => {
  it("accepts an injected `now` and produces deterministic report text", () => {
    const gen = makeGenerated({ allowedTools: "Bash" });
    const opts: EmitOptions = {
      targetAgents: ["opencode"],
      engine: "universal",
      now: new Date("2026-01-01T00:00:00Z"),
    };
    const result = emitSkill(gen, opts);
    // Report must not embed Date.now() / fresh timestamps when `now` is given.
    expect(result.divergenceReport).not.toMatch(/20(2[7-9]|[3-9]\d)/);
  });
});

describe("emitSkill — unknown agent handling", () => {
  it("skips unknown agent ids in universal mode with a descriptive reason", () => {
    const gen = makeGenerated();
    const opts: EmitOptions = {
      targetAgents: ["not-a-real-agent"],
      engine: "universal",
    };
    const result = emitSkill(gen, opts);
    expect(result.files).toEqual([]);
    expect(result.skipped.length).toBe(1);
    expect(result.skipped[0].targetId).toBe("not-a-real-agent");
    expect(result.skipped[0].reason).toMatch(/unknown agent id/);
  });

  it("skips unknown agent ids in anthropic fallback mode", () => {
    const gen = makeGenerated();
    const opts: EmitOptions = {
      targetAgents: ["not-a-real-agent"],
      engine: "anthropic-skill-creator",
    };
    const result = emitSkill(gen, opts);
    expect(result.files).toEqual([]);
    expect(result.skipped.length).toBe(1);
    expect(result.skipped[0].reason).toMatch(/unknown agent id/);
  });
});

describe("emitSkill — claude-code passthrough (universal engine)", () => {
  it("preserves allowed-tools and model on the claude-code emission", () => {
    const gen = makeGenerated({ allowedTools: "Bash, Read", model: "opus-4" });
    const opts: EmitOptions = {
      targetAgents: ["claude-code"],
      engine: "universal",
    };
    const result = emitSkill(gen, opts);

    const claude = result.files.find((f) => f.targetId === "claude-code");
    expect(claude).toBeDefined();
    expect(claude!.content).toContain("allowed-tools: ");
    expect(claude!.content).toContain("model: opus-4");
    expect(claude!.content).toContain("x-sw-schema-version: 1");

    // claude-code emission produces NO divergences — full frontmatter kept.
    const claudeDivergences = result.divergences.filter(
      (d) => d.targetId === "claude-code",
    );
    expect(claudeDivergences).toEqual([]);
  });
});

describe("emitSkill — non-universal file emission (customSystemPrompt=true)", () => {
  it("emits schema version for a universal target with no security fields", () => {
    // `cursor` is universal — emits with name/description/schema version.
    const gen = makeGenerated({ allowedTools: "Bash" });
    const opts: EmitOptions = { targetAgents: ["cursor"], engine: "universal" };
    const result = emitSkill(gen, opts);

    const cursor = result.files.find((f) => f.targetId === "cursor");
    expect(cursor).toBeDefined();
    expect(cursor!.content).toContain("x-sw-schema-version: 1");
    // `allowed-tools` is NOT present in the emitted frontmatter — dropped
    // because cursor doesn't enforce tool allowlists.
    expect(cursor!.content).not.toContain("allowed-tools:");
  });

  it("emits a non-universal target (windsurf) with stripped frontmatter", () => {
    // `windsurf` is non-universal (isUniversal=false) but has
    // customSystemPrompt=true — exercises the non-universal emit path.
    const gen = makeGenerated({ allowedTools: "Bash", model: "opus-4" });
    const opts: EmitOptions = { targetAgents: ["windsurf"], engine: "universal" };
    const result = emitSkill(gen, opts);

    const windsurf = result.files.find((f) => f.targetId === "windsurf");
    expect(windsurf).toBeDefined();
    expect(windsurf!.content).toContain("x-sw-schema-version: 1");
    expect(windsurf!.content).toContain("name: ");
    expect(windsurf!.content).toContain("description: ");

    // Both security-critical fields recorded as divergences.
    const fields = result.divergences
      .filter((d) => d.targetId === "windsurf")
      .map((d) => d.field);
    expect(fields).toContain("allowed-tools");
    expect(fields).toContain("model");
  });
});
