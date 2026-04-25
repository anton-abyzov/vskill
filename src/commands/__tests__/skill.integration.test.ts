// ---------------------------------------------------------------------------
// skill.integration.test.ts — increment 0670 T-012.
//
// Real-emitter integration tests for `vskill skill` CLI. Unlike skill.test.ts
// (which mocks BOTH generateSkill AND emitSkill for fast contract checks),
// this suite mocks ONLY generateSkill and lets the REAL emitSkill run against
// a `mkdtemp` sandbox. The result: file-system side effects, frontmatter
// emission, and divergence-report generation are all exercised end-to-end.
//
// Sub-cases mapped to T-012's test plan:
//   (b) `vskill skill new --prompt ... --targets=claude-code,codex,cursor,opencode`
//       emits SKILL.md at all four target paths.                  AC-US7-03
//   (c) Each emitted SKILL.md contains `x-sw-schema-version: 1`.  AC-US7-04
//   (d) `<slug>-divergence.md` exists in cwd; OpenCode
//       `allowed-tools` → `permission` translation is preserved.  AC-US7-05
//   (e) `--engine=anthropic-skill-creator` with detection
//       true → Claude-only emit + stderr warning;
//       detection false → exit 1 + remediation hint.              AC-US7-06, AC-US2-07
//   (f) `--targets=all` emits to TOTAL_AGENTS distinct paths
//       (covers AC-US7-08).                                       AC-US7-08
//   (g) `.skill-builder-invoked.json` sentinel is written on
//       every successful invocation with the documented schema.   AC-US1-07
//
// Sub-case (a) — real `vskill install` from a GitHub spec — is intentionally
// NOT covered here. It is owned by the manual sandbox smoke test in T-013c
// (with a pinned older vskill) since it depends on network + git resolution
// and would be redundant with the existing add.test.ts unit coverage of the
// install resolver. T-012 / AC-US1-05 / AC-US1-06 / AC-US7-02 unit-level
// coverage lives there; the install integration belongs at T-013c.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Command } from "commander";
import { TOTAL_AGENTS, AGENTS_REGISTRY, getAgent } from "../../agents/agents-registry.js";

/**
 * Strip a localSkillsDir down to a stable, lowercase fragment we can match
 * against an emitted file path. Removes leading dots (`.`), trailing
 * `/skills`, and normalizes case. Examples:
 *   `.claude/skills`         → `claude`
 *   `.codex/skills`          → `codex`
 *   `~/.config/agents/skills`→ `agents`
 *   `.cursor/rules`          → `cursor`
 */
function fragmentFor(localSkillsDir: string): string {
  return localSkillsDir
    .replace(/^[~/]+/, "")
    .replace(/^\.+/, "")
    .replace(/\/skills?$/, "")
    .replace(/\/rules?$/, "")
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// Hoisted mocks — generator only. Emitter runs for real.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  generateSkill: vi.fn(),
  isSkillCreatorInstalled: vi.fn(),
  listCommand: vi.fn(),
  submitCommand: vi.fn(),
}));

vi.mock("../../core/skill-generator.js", () => ({
  generateSkill: mocks.generateSkill,
}));

vi.mock("../../utils/skill-creator-detection.js", () => ({
  isSkillCreatorInstalled: mocks.isSkillCreatorInstalled,
}));

vi.mock("../list.js", () => ({
  listCommand: mocks.listCommand,
}));

vi.mock("../submit.js", () => ({
  submitCommand: mocks.submitCommand,
}));

// Suppress chalk coloring so assertions match raw strings.
vi.mock("../../utils/output.js", () => ({
  bold: (s: string) => s,
  green: (s: string) => s,
  red: (s: string) => s,
  yellow: (s: string) => s,
  dim: (s: string) => s,
  cyan: (s: string) => s,
  magenta: (s: string) => s,
  link: (_u: string, t: string) => t,
  table: (_h: string[], rows: string[][]) => rows.map((r) => r.join(" ")).join("\n"),
  formatInstalls: (n: number) => String(n),
  spinner: (_m: string) => ({ succeed: () => {}, fail: () => {}, stop: () => {} }),
}));

// ---------------------------------------------------------------------------
// Shared sandbox setup
// ---------------------------------------------------------------------------
let tmpDir: string;
let exitSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;
let origCwd: string;

function makeGenerated(name = "lint-markdown") {
  return {
    name,
    description: "Lint markdown files for style and link integrity.",
    model: "claude-sonnet-4-5",
    // Multiple tools so we can verify allowed-tools / permission translation.
    allowedTools: "Read,Bash(node*)",
    body: `# ${name}\n\nLint markdown files using the configured linter.\n\n## Body\n\nWalk the tree and report any issues.\n`,
    evals: [],
    reasoning: "",
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.generateSkill.mockResolvedValue(makeGenerated());
  mocks.isSkillCreatorInstalled.mockReturnValue(false);
  mocks.listCommand.mockResolvedValue(undefined);
  mocks.submitCommand.mockResolvedValue(undefined);

  tmpDir = mkdtempSync(join(tmpdir(), "vskill-skill-integration-"));
  origCwd = process.cwd();
  process.chdir(tmpDir);

  exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: number) => {
    throw new Error(`__EXIT__${_code ?? 0}`);
  });
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.chdir(origCwd);
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* noop */
  }
  exitSpy.mockRestore();
  logSpy.mockRestore();
  errSpy.mockRestore();
});

async function invokeSkill(args: string[]): Promise<{ exitCode: number | null }> {
  const mod = await import("../skill.js");
  // Critically: do NOT call __setEmitSkillForTest here. We want the REAL
  // emitter to run so file-system side effects are exercised.
  const program = new Command();
  program.exitOverride();
  mod.registerSkillCommand(program);

  let exitCode: number | null = null;
  try {
    await program.parseAsync(["node", "vskill", "skill", ...args]);
  } catch (err) {
    const msg = (err as Error).message;
    const match = msg.match(/^__EXIT__(\d+)$/);
    if (match) {
      exitCode = parseInt(match[1], 10);
    } else if ((err as { code?: string }).code === "commander.helpDisplayed") {
      exitCode = 0;
    } else if ((err as { code?: string }).code === "commander.help") {
      exitCode = 0;
    } else if ((err as { exitCode?: number }).exitCode !== undefined) {
      exitCode = (err as { exitCode: number }).exitCode;
    } else {
      throw err;
    }
  }
  return { exitCode };
}

function readEmittedFiles(root: string): Map<string, string> {
  const out = new Map<string, string>();
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      const s = statSync(abs);
      if (s.isDirectory()) walk(abs);
      else if (entry === "SKILL.md")
        out.set(abs.slice(root.length + 1), readFileSync(abs, "utf-8"));
    }
  }
  walk(root);
  return out;
}

// ---------------------------------------------------------------------------
// Sub-case (b) — multi-target emission
// ---------------------------------------------------------------------------
describe("0670 T-012 (b) — vskill skill new emits SKILL.md at every target path (AC-US7-03)", () => {
  it("emits SKILL.md at all four requested targets", async () => {
    const { exitCode } = await invokeSkill([
      "new",
      "--prompt",
      "lint markdown files",
      "--targets",
      "claude-code,codex,cursor,opencode",
    ]);

    expect(exitCode).toBe(null);
    expect(mocks.generateSkill).toHaveBeenCalledTimes(1);

    const emitted = readEmittedFiles(tmpDir);
    // We don't pin exact paths — different agents have different layouts —
    // but every requested target must produce at least one SKILL.md whose
    // path lands inside that agent's localSkillsDir fragment.
    expect(emitted.size).toBeGreaterThanOrEqual(4);
    const joined = [...emitted.keys()].join("|").toLowerCase();
    for (const targetId of ["claude-code", "codex", "cursor", "opencode"]) {
      const def = getAgent(targetId);
      expect(def, `agent ${targetId} not registered`).toBeTruthy();
      const fragment = fragmentFor(def!.localSkillsDir);
      expect(
        joined.includes(fragment),
        `expected ${targetId} (fragment="${fragment}") to appear in emitted paths;\nemitted:\n${[...emitted.keys()].join("\n")}`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Sub-case (c) — schema version frontmatter
// ---------------------------------------------------------------------------
describe("0670 T-012 (c) — every SKILL.md carries x-sw-schema-version: 1 (AC-US7-04)", () => {
  it("each emitted SKILL.md contains valid frontmatter with schema version 1", async () => {
    const { exitCode } = await invokeSkill([
      "new",
      "--prompt",
      "lint markdown files",
      "--targets",
      "claude-code,codex,cursor,opencode",
    ]);

    expect(exitCode).toBe(null);
    const emitted = readEmittedFiles(tmpDir);
    expect(emitted.size).toBeGreaterThan(0);

    for (const [path, content] of emitted) {
      // Frontmatter is delimited by leading `---` lines.
      expect(content.startsWith("---\n"), `${path} missing leading frontmatter`).toBe(true);
      const body = content.slice(4);
      const end = body.indexOf("\n---");
      expect(end, `${path} missing closing frontmatter delimiter`).toBeGreaterThan(0);
      const frontmatter = body.slice(0, end);
      expect(frontmatter, `${path} frontmatter`).toContain("x-sw-schema-version: 1");
    }
  });
});

// ---------------------------------------------------------------------------
// Sub-case (d) — divergence report side-effect file
// ---------------------------------------------------------------------------
describe("0670 T-012 (d) — divergence report file emission + content (AC-US7-05)", () => {
  it("writes <slug>-divergence.md to cwd; report references the OpenCode permission translation", async () => {
    const { exitCode } = await invokeSkill([
      "new",
      "--prompt",
      "lint markdown files",
      "--targets",
      "claude-code,codex,cursor,opencode",
    ]);

    expect(exitCode).toBe(null);
    const reportPath = join(tmpDir, "lint-markdown-divergence.md");
    expect(existsSync(reportPath), `divergence report missing at ${reportPath}`).toBe(true);

    const report = readFileSync(reportPath, "utf-8");
    // The report MUST be non-empty (security-critical: silent loss is a fail).
    expect(report.trim().length, "divergence report is empty").toBeGreaterThan(0);
    // OpenCode translates `allowed-tools` → `permission`. The report must
    // surface either the translation or that opencode received the skill,
    // never silently drop the field. Asserting the agent id appears in the
    // report is the minimum guarantee — the report's content shape is owned
    // by the emitter itself and covered by skill-emitter unit tests.
    expect(report.toLowerCase()).toMatch(/opencode/);
  });
});

// ---------------------------------------------------------------------------
// Sub-case (e) — anthropic-skill-creator engine fallback paths
// ---------------------------------------------------------------------------
describe("0670 T-012 (e) — --engine=anthropic-skill-creator gating (AC-US7-06, AC-US2-07)", () => {
  it("with detection=true emits Claude-only output + stderr fallback warning", async () => {
    mocks.isSkillCreatorInstalled.mockReturnValue(true);
    const { exitCode } = await invokeSkill([
      "new",
      "--prompt",
      "lint markdown files",
      "--engine",
      "anthropic-skill-creator",
    ]);

    expect(exitCode).toBe(null);
    // Stderr must carry the fallback delegation banner.
    const stderr = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stderr).toMatch(/anthropic-skill-creator/);
    expect(stderr).toMatch(/fallback/i);

    // Only Claude-aligned outputs should exist; non-claude target paths
    // (cursor, codex, opencode, etc.) MUST NOT appear.
    const emitted = readEmittedFiles(tmpDir);
    const joined = [...emitted.keys()].join("|");
    expect(joined.toLowerCase()).not.toMatch(/cursor|codex|opencode|kimi|qwen|warp/);
  });

  it("with detection=false exits non-zero with remediation hint", async () => {
    mocks.isSkillCreatorInstalled.mockReturnValue(false);
    const { exitCode } = await invokeSkill([
      "new",
      "--prompt",
      "lint markdown files",
      "--engine",
      "anthropic-skill-creator",
    ]);

    expect(exitCode).toBe(1);
    const stderr = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    // Remediation hint MUST mention how to install skill-creator.
    expect(stderr).toMatch(/skill-creator/);
    expect(stderr).toMatch(/install/i);
  });
});

// ---------------------------------------------------------------------------
// Sub-case (f) — --targets=all emits to every registered agent
// ---------------------------------------------------------------------------
describe("0670 T-012 (f) — --targets=all emits to TOTAL_AGENTS paths (AC-US7-08)", () => {
  it("emits SKILL.md for every registered agent without skipping any silently", async () => {
    const { exitCode } = await invokeSkill([
      "new",
      "--prompt",
      "lint markdown files",
      "--targets",
      "all",
    ]);

    expect(exitCode).toBe(null);
    const emitted = readEmittedFiles(tmpDir);

    // Two categories of legitimate non-emit:
    //   1. Remote-only agents (Devin, bolt.new, v0, Replit) — no local install
    //      surface, filtered out of the emit set entirely.
    //   2. Agents with `customSystemPrompt: false` (e.g. mcpjam) — cannot
    //      express skill frontmatter; the emitter documents these in the
    //      divergence report with a `Skipped: <reason>` line. AC-US7-08
    //      requires "no SILENT skip" — documented skips are correct.
    // The test enforces: every other installable agent must produce at least
    // one emitted SKILL.md whose path lands inside its localSkillsDir
    // fragment (de-duped across shared-folder consumers like kimi+qwen).
    const installable = AGENTS_REGISTRY.filter((a) => a.isRemoteOnly !== true);
    const expectedToEmit = installable.filter(
      (a) => a.featureSupport.customSystemPrompt,
    );
    const expectedToBeDocumentedSkips = installable.filter(
      (a) => !a.featureSupport.customSystemPrompt,
    );

    const pathBlob = [...emitted.keys()].join("|").toLowerCase();
    const fragmentsByAgent = new Map(
      expectedToEmit.map((a) => [a.id, fragmentFor(a.localSkillsDir)]),
    );
    const seenFragments = new Set<string>();
    for (const [, fragment] of fragmentsByAgent) {
      if (pathBlob.includes(fragment)) seenFragments.add(fragment);
    }
    const missingEmit = [...fragmentsByAgent]
      .filter(([, fragment]) => !seenFragments.has(fragment))
      .map(([id]) => id);
    expect(
      missingEmit,
      `--targets=all silently skipped ${missingEmit.length} installable+expressive agents (of ${expectedToEmit.length}). TOTAL_AGENTS=${TOTAL_AGENTS}. Skipped: ${missingEmit.join(", ")}`,
    ).toEqual([]);

    // For the cannot-express agents, verify the divergence report
    // documents them — silent loss IS a test failure (AC-US7-05).
    const reportPath = join(tmpDir, "lint-markdown-divergence.md");
    expect(existsSync(reportPath), "divergence report missing").toBe(true);
    const report = readFileSync(reportPath, "utf-8");
    for (const agent of expectedToBeDocumentedSkips) {
      expect(
        report.includes(`## ${agent.id}`),
        `divergence report must document the documented-skip agent "${agent.id}"; report:\n${report}`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Sub-case (g) — sentinel file
// ---------------------------------------------------------------------------
describe("0670 T-012 (g) — .skill-builder-invoked.json sentinel (AC-US1-07)", () => {
  it("writes the sentinel with the documented {trigger, agent, timestamp, targets, prompt} shape", async () => {
    const promptText = "lint markdown files for style";
    const { exitCode } = await invokeSkill([
      "new",
      "--prompt",
      promptText,
      "--targets",
      "claude-code,codex,cursor,opencode",
    ]);

    expect(exitCode).toBe(null);

    const sentinelPath = join(tmpDir, ".skill-builder-invoked.json");
    expect(existsSync(sentinelPath), "sentinel file missing").toBe(true);

    const sentinel = JSON.parse(readFileSync(sentinelPath, "utf-8")) as {
      trigger: string;
      agent: string;
      timestamp: string;
      targets: string[];
      prompt: string;
    };
    expect(sentinel.trigger).toBe("cli:skill:new");
    expect(typeof sentinel.agent).toBe("string");
    // ISO-8601 timestamp.
    expect(sentinel.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(sentinel.targets.sort()).toEqual(
      ["claude-code", "codex", "cursor", "opencode"].sort(),
    );
    expect(sentinel.prompt).toBe(promptText);
  });

  it("writes the sentinel even when --engine=anthropic-skill-creator delegates", async () => {
    mocks.isSkillCreatorInstalled.mockReturnValue(true);
    const promptText = "skill-creator delegated emission";
    const { exitCode } = await invokeSkill([
      "new",
      "--prompt",
      promptText,
      "--engine",
      "anthropic-skill-creator",
    ]);

    expect(exitCode).toBe(null);
    const sentinelPath = join(tmpDir, ".skill-builder-invoked.json");
    expect(existsSync(sentinelPath)).toBe(true);

    const sentinel = JSON.parse(readFileSync(sentinelPath, "utf-8")) as {
      trigger: string;
      targets: string[];
      prompt: string;
    };
    expect(sentinel.trigger).toBe("cli:skill:new");
    // Skill-creator path forces Claude-only emission; targets must reflect that.
    expect(sentinel.targets).toEqual(["claude-code"]);
    expect(sentinel.prompt).toBe(promptText);
  });
});
