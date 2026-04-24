// ---------------------------------------------------------------------------
// skill.test.ts — contract tests for `vskill skill` CLI subcommand family
// (increment 0670 T-004..T-007).
//
// Covers AC-US3-01..12, AC-US2-03, AC-US2-07, AC-US1-07.
//
// The emitter (src/core/skill-emitter.ts) and generator
// (src/core/skill-generator.ts) are mocked so these tests do NOT depend on
// Chain D's GREEN state nor on a live LLM.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Command } from "commander";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  generateSkill: vi.fn(),
  emitSkill: vi.fn(),
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

// Suppress chalk coloring so assertions match on raw strings.
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
// Shared setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let exitSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;
let origCwd: string;

function makeGenerated() {
  return {
    name: "lint-markdown",
    description: "Lint markdown files.",
    model: "",
    allowedTools: "",
    body: "# lint-markdown\n\nBody here.\n",
    evals: [],
    reasoning: "",
  };
}

function makeEmitResult(targets: string[]) {
  return {
    files: targets.map((id) => ({
      targetId: id,
      relativePath: `.agents/skills/lint-markdown/SKILL.md`,
      content: `---\nname: lint-markdown\n---\n\nbody\n`,
    })),
    divergences: [],
    skipped: [],
    divergenceReport: "# divergence\n",
  };
}

beforeEach(async () => {
  vi.resetAllMocks();
  mocks.generateSkill.mockResolvedValue(makeGenerated());
  mocks.emitSkill.mockImplementation((_g, opts: { targetAgents: string[] }) =>
    makeEmitResult(opts.targetAgents),
  );
  mocks.isSkillCreatorInstalled.mockReturnValue(false);
  mocks.listCommand.mockResolvedValue(undefined);
  mocks.submitCommand.mockResolvedValue(undefined);

  // Install mock for the Chain C local stub of emitSkill. Tests use
  // runSkillCommandForTest() which injects the mocked emitter directly.
  tmpDir = mkdtempSync(join(tmpdir(), "vskill-skill-test-"));
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
  // Inject the mocked emitter so skill.ts sees our spy (no module resolution
  // required for the stub that lives inside skill.ts).
  if (typeof mod.__setEmitSkillForTest === "function") {
    mod.__setEmitSkillForTest(mocks.emitSkill);
  }
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

// ---------------------------------------------------------------------------
// Tests — AC-US3-01..12
// ---------------------------------------------------------------------------

describe("vskill skill — argument validation (AC-US3-11, AC-US3-12)", () => {
  it("missing --prompt exits non-zero with usage hint", async () => {
    const { exitCode } = await invokeSkill(["new"]);
    expect(exitCode).not.toBe(0);
    const stderr = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(stderr).toMatch(/--prompt/i);
  });

  it("empty --prompt exits non-zero", async () => {
    const { exitCode } = await invokeSkill(["new", "--prompt", ""]);
    expect(exitCode).not.toBe(0);
  });

  it("unknown target id exits non-zero with Unknown agent id message", async () => {
    const { exitCode } = await invokeSkill([
      "new",
      "--prompt",
      "lint markdown",
      "--targets",
      "made-up-agent",
    ]);
    expect(exitCode).not.toBe(0);
    const stderr = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(stderr).toMatch(/Unknown agent id: made-up-agent/);
  });

  it("partial-unknown targets does NOT emit anything (all-or-nothing)", async () => {
    const { exitCode } = await invokeSkill([
      "new",
      "--prompt",
      "x",
      "--targets",
      "claude-code,made-up-agent",
    ]);
    expect(exitCode).not.toBe(0);
    expect(mocks.emitSkill).not.toHaveBeenCalled();
    expect(mocks.generateSkill).not.toHaveBeenCalled();
  });
});

describe("vskill skill new — target resolution (AC-US3-03, AC-US3-04)", () => {
  it("no --targets defaults to 8 universal agents", async () => {
    const { exitCode } = await invokeSkill(["new", "--prompt", "lint markdown"]);
    expect(exitCode ?? 0).toBe(0);
    expect(mocks.emitSkill).toHaveBeenCalledTimes(1);
    const opts = mocks.emitSkill.mock.calls[0][1] as { targetAgents: string[] };
    expect(opts.targetAgents).toHaveLength(8);
    // 8 canonical universal ids
    expect(opts.targetAgents).toEqual(
      expect.arrayContaining([
        "amp",
        "cline",
        "codex",
        "cursor",
        "gemini-cli",
        "github-copilot-ext",
        "kimi-cli",
        "opencode",
      ]),
    );
  });

  it("--targets=all resolves to all 53 agents", async () => {
    const { exitCode } = await invokeSkill([
      "new",
      "--prompt",
      "lint markdown",
      "--targets",
      "all",
    ]);
    expect(exitCode ?? 0).toBe(0);
    const opts = mocks.emitSkill.mock.calls[0][1] as { targetAgents: string[] };
    expect(opts.targetAgents).toHaveLength(53);
  });

  it("--targets=claude-code,codex resolves to exactly those two", async () => {
    const { exitCode } = await invokeSkill([
      "new",
      "--prompt",
      "x",
      "--targets",
      "claude-code,codex",
    ]);
    expect(exitCode ?? 0).toBe(0);
    const opts = mocks.emitSkill.mock.calls[0][1] as { targetAgents: string[] };
    expect(opts.targetAgents).toEqual(["claude-code", "codex"]);
  });

  it("--targets=github-copilot (legacy alias) resolves to github-copilot-ext", async () => {
    const { exitCode } = await invokeSkill([
      "new",
      "--prompt",
      "x",
      "--targets",
      "github-copilot",
    ]);
    expect(exitCode ?? 0).toBe(0);
    const opts = mocks.emitSkill.mock.calls[0][1] as { targetAgents: string[] };
    expect(opts.targetAgents).toEqual(["github-copilot-ext"]);
  });
});

describe("vskill skill new — pipeline side effects (AC-US1-07, AC-US3-02)", () => {
  it("writes emitted files to cwd and a divergence report", async () => {
    const { exitCode } = await invokeSkill([
      "new",
      "--prompt",
      "x",
      "--targets",
      "claude-code",
    ]);
    expect(exitCode ?? 0).toBe(0);
    expect(existsSync(join(tmpDir, ".agents/skills/lint-markdown/SKILL.md"))).toBe(
      true,
    );
    // Divergence report uses the skill slug.
    expect(existsSync(join(tmpDir, "lint-markdown-divergence.md"))).toBe(true);
  });

  it("writes .skill-builder-invoked.json sentinel after successful emit", async () => {
    const { exitCode } = await invokeSkill([
      "new",
      "--prompt",
      "lint markdown files",
      "--targets",
      "claude-code",
    ]);
    expect(exitCode ?? 0).toBe(0);
    const sentinelPath = join(tmpDir, ".skill-builder-invoked.json");
    expect(existsSync(sentinelPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(sentinelPath, "utf-8"));
    expect(parsed).toMatchObject({
      prompt: "lint markdown files",
      targets: ["claude-code"],
    });
    expect(typeof parsed.agent).toBe("string");
    expect(typeof parsed.timestamp).toBe("string");
    expect(typeof parsed.trigger).toBe("string");
  });
});

describe("vskill skill new --engine=anthropic-skill-creator (AC-US3-05, AC-US2-07)", () => {
  it("delegates to skill-creator and emits Claude-only when installed", async () => {
    mocks.isSkillCreatorInstalled.mockReturnValue(true);
    const { exitCode } = await invokeSkill([
      "new",
      "--prompt",
      "x",
      "--engine",
      "anthropic-skill-creator",
    ]);
    expect(exitCode ?? 0).toBe(0);
    const stderr = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(stderr).toMatch(/\[skill-builder\]/);
    expect(mocks.emitSkill).toHaveBeenCalledTimes(1);
    const opts = mocks.emitSkill.mock.calls[0][1] as {
      engine: string;
      targetAgents: string[];
    };
    expect(opts.engine).toBe("anthropic-skill-creator");
    expect(opts.targetAgents).toEqual(["claude-code"]);
  });

  it("exits non-zero with remediation when skill-creator is missing", async () => {
    mocks.isSkillCreatorInstalled.mockReturnValue(false);
    const { exitCode } = await invokeSkill([
      "new",
      "--prompt",
      "x",
      "--engine",
      "anthropic-skill-creator",
    ]);
    expect(exitCode).not.toBe(0);
    const stderr = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(stderr).toMatch(/npm i -g vskill/);
    expect(stderr).toMatch(/claude plugin install skill-creator/);
  });
});

describe("vskill skill import (AC-US3-06)", () => {
  it("reads an existing SKILL.md and re-emits with preserved body", async () => {
    const fixturePath = join(
      __dirname,
      "fixtures/existing-skill/SKILL.md",
    );
    const { exitCode } = await invokeSkill([
      "import",
      fixturePath,
      "--targets",
      "claude-code",
    ]);
    expect(exitCode ?? 0).toBe(0);
    expect(mocks.emitSkill).toHaveBeenCalledTimes(1);
    const [generated, opts] = mocks.emitSkill.mock.calls[0] as [
      { name: string; body: string; description: string },
      { targetAgents: string[] },
    ];
    // Name derived from frontmatter (heading # /lint-markdown → lint-markdown).
    expect(generated.name).toBe("lint-markdown");
    expect(generated.description).toMatch(/Lint markdown files/);
    // Body preserved — contains the fixture text.
    expect(generated.body).toMatch(/# \/lint-markdown/);
    expect(generated.body).toMatch(/passive voice/);
    expect(opts.targetAgents).toEqual(["claude-code"]);
    // Import MUST NOT call the generator.
    expect(mocks.generateSkill).not.toHaveBeenCalled();
  });

  it("import of a missing file exits non-zero", async () => {
    const { exitCode } = await invokeSkill([
      "import",
      "/nope/does/not/exist.md",
    ]);
    expect(exitCode).not.toBe(0);
  });

  it("import with unknown target id exits non-zero", async () => {
    const fixturePath = join(
      __dirname,
      "fixtures/existing-skill/SKILL.md",
    );
    const { exitCode } = await invokeSkill([
      "import",
      fixturePath,
      "--targets",
      "made-up-agent",
    ]);
    expect(exitCode).not.toBe(0);
    const stderr = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(stderr).toMatch(/Unknown agent id/);
    expect(mocks.emitSkill).not.toHaveBeenCalled();
  });
});

describe("vskill skill list / publish aliases (AC-US3-07, AC-US3-08)", () => {
  it("list delegates to listCommand", async () => {
    const { exitCode } = await invokeSkill(["list"]);
    expect(exitCode ?? 0).toBe(0);
    expect(mocks.listCommand).toHaveBeenCalledTimes(1);
  });

  it("publish delegates to submitCommand", async () => {
    const { exitCode } = await invokeSkill(["publish", "my-skill"]);
    expect(exitCode ?? 0).toBe(0);
    expect(mocks.submitCommand).toHaveBeenCalledTimes(1);
    const args = mocks.submitCommand.mock.calls[0];
    expect(args[0]).toBe("my-skill");
  });
});

describe("vskill skill --help (AC-US3-10)", () => {
  it("lists all 5 subcommands", async () => {
    // Build program and capture help text manually to avoid commander's
    // process.exit inside help output.
    const mod = await import("../skill.js");
    const program = new Command();
    program.exitOverride();
    mod.registerSkillCommand(program);
    const skill = program.commands.find((c) => c.name() === "skill");
    expect(skill).toBeDefined();
    const help = skill!.helpInformation();
    expect(help).toMatch(/\bnew\b/);
    expect(help).toMatch(/\bimport\b/);
    expect(help).toMatch(/\blist\b/);
    expect(help).toMatch(/\binfo\b/);
    expect(help).toMatch(/\bpublish\b/);
  });
});

describe("vskill skill info (AC-US3-07)", () => {
  it("prints frontmatter for a skill whose SKILL.md can be located", async () => {
    // Seed a SKILL.md in the cwd canonical path so info can find it.
    const skillDir = join(tmpDir, ".agents/skills/demo-skill");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      '---\nname: demo-skill\ndescription: "Demo."\nmodel: sonnet\nallowed-tools: Read, Write\n---\n\n# demo-skill\n',
    );

    const { exitCode } = await invokeSkill(["info", "demo-skill"]);
    expect(exitCode ?? 0).toBe(0);
    const stdout = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(stdout).toMatch(/demo-skill/);
    expect(stdout).toMatch(/Demo\./);
    expect(stdout).toMatch(/sonnet/);
    expect(stdout).toMatch(/Read, Write/);
  });

  it("prints divergence report when one exists beside SKILL.md", async () => {
    const skillDir = join(tmpDir, ".agents/skills/demo-skill");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      '---\nname: demo-skill\ndescription: "Demo."\n---\n\n# demo-skill\n',
    );
    writeFileSync(
      join(skillDir, "demo-skill-divergence.md"),
      "# Divergence\n\n- dropped: allowed-tools\n",
    );

    const { exitCode } = await invokeSkill(["info", "demo-skill"]);
    expect(exitCode ?? 0).toBe(0);
    const stdout = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(stdout).toMatch(/Divergence report/);
    expect(stdout).toMatch(/dropped: allowed-tools/);
  });

  it("exits non-zero when the skill cannot be located locally", async () => {
    const { exitCode } = await invokeSkill(["info", "nonexistent-skill"]);
    expect(exitCode).not.toBe(0);
    const stderr = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(stderr).toMatch(/Skill not found locally/);
  });
});
