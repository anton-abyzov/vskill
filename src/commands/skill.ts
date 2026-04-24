// ---------------------------------------------------------------------------
// vskill skill — subcommand family for the skill-builder workflow.
//
// Increment 0670 (T-004..T-007). Exposes:
//   vskill skill new      — generate + emit a new skill from a prompt
//   vskill skill import   — re-emit an existing SKILL.md against targets
//   vskill skill list     — thin alias for `vskill list`
//   vskill skill info     — show frontmatter + divergence report
//   vskill skill publish  — alias for `vskill submit`
//
// Satisfies AC-US3-01..12, AC-US2-03, AC-US2-07, AC-US1-07.
// ---------------------------------------------------------------------------

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Command } from "commander";

import {
  AGENTS_REGISTRY,
  LEGACY_AGENT_IDS,
  getAgent,
  getUniversalAgents,
} from "../agents/agents-registry.js";
import { generateSkill, type GenerateSkillResult } from "../core/skill-generator.js";
import { isSkillCreatorInstalled } from "../utils/skill-creator-detection.js";
import { bold, cyan, dim, green, red, yellow } from "../utils/output.js";
import { listCommand } from "./list.js";
import { submitCommand } from "./submit.js";
import {
  emitSkill as realEmitSkill,
  type EmitOptions,
  type EmittedFileDescriptor,
  type DivergenceEntry,
  type EmitResult,
  type EngineMode,
} from "../core/skill-emitter.js";

// Re-export emitter types so existing callers/tests don't need to change their import paths.
export type {
  EmitOptions,
  EmittedFileDescriptor,
  DivergenceEntry,
  EmitResult,
  EngineMode,
};

type EmitSkillFn = typeof realEmitSkill;

/**
 * Tests inject a mock via this setter instead of `vi.mock()` on the module
 * path (which is awkward for the ESM-dist-resolver setup). In production the
 * default is the real `emitSkill` from `src/core/skill-emitter.ts`.
 */
let emitSkillImpl: EmitSkillFn = realEmitSkill;

export function __setEmitSkillForTest(fn: EmitSkillFn | null): void {
  emitSkillImpl = fn ?? realEmitSkill;
}

// ---------------------------------------------------------------------------
// Host-agent detection for the sentinel file (AC-US1-07)
// ---------------------------------------------------------------------------

function detectHostAgent(): string {
  const env = process.env;
  if (env.CLAUDECODE || env.CLAUDE_CODE_BIN || env.CLAUDE_CODE_INSTANCE) {
    return "claude-code";
  }
  if (env.CODEX_API_KEY || env.CODEX_SESSION || env.CODEX_HOME) {
    return "codex";
  }
  if (env.CURSOR_SESSION || env.CURSOR_AGENT_ID) return "cursor";
  if (env.WINDSURF_SESSION_ID) return "windsurf";
  if (env.GEMINI_CLI_SESSION || env.GEMINI_API_KEY) return "gemini-cli";
  if (env.VSKILL_HOST_AGENT) return env.VSKILL_HOST_AGENT;
  return "unknown";
}

// ---------------------------------------------------------------------------
// Target resolution (AC-US3-03, AC-US3-04, AC-US3-11)
// ---------------------------------------------------------------------------

function resolveTargets(
  flag: string | undefined,
): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (!flag || flag.trim() === "") {
    // Default: 8 universal agents, runtime-filtered so the set expands when
    // new universal agents land in the registry.
    const ids = getUniversalAgents().map((a) => a.id);
    return { ok: true, ids };
  }

  const normalized = flag.trim().toLowerCase();
  if (normalized === "all") {
    return { ok: true, ids: AGENTS_REGISTRY.map((a) => a.id) };
  }

  const requested = flag
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const raw of requested) {
    const canonical = LEGACY_AGENT_IDS[raw] ?? raw;
    const agent = getAgent(canonical);
    if (!agent) {
      return {
        ok: false,
        error: `Unknown agent id: ${raw}. Run 'vskill skill new --list-targets' for valid ids.`,
      };
    }
    if (!seen.has(agent.id)) {
      seen.add(agent.id);
      resolved.push(agent.id);
    }
  }
  return { ok: true, ids: resolved };
}

// ---------------------------------------------------------------------------
// Pipeline helpers shared by `new` and `import`
// ---------------------------------------------------------------------------

function writeEmittedFiles(
  cwd: string,
  result: EmitResult,
  slug: string,
): { filesWritten: number; reportPath: string } {
  for (const file of result.files) {
    const fullPath = isAbsolute(file.relativePath)
      ? file.relativePath
      : join(cwd, file.relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, file.content, "utf-8");
  }

  const reportPath = join(cwd, `${slug}-divergence.md`);
  writeFileSync(reportPath, result.divergenceReport, "utf-8");
  return { filesWritten: result.files.length, reportPath };
}

function writeSentinel(
  cwd: string,
  trigger: string,
  targets: string[],
  prompt: string,
): void {
  const sentinelPath = join(cwd, ".skill-builder-invoked.json");
  const sentinel = {
    trigger,
    agent: detectHostAgent(),
    timestamp: new Date().toISOString(),
    targets,
    prompt,
  };
  writeFileSync(sentinelPath, JSON.stringify(sentinel, null, 2), "utf-8");
}

function exit(code: number): never {
  // Wrap through process.exit so the Vitest spy can intercept without
  // terminating the test worker.
  process.exit(code);
  // process.exit does not return; the cast satisfies TS when exit is spied.
  throw new Error("process.exit did not terminate");
}

// ---------------------------------------------------------------------------
// `vskill skill new`
// ---------------------------------------------------------------------------

interface SkillNewOpts {
  prompt?: string;
  targets?: string;
  engine?: string;
}

async function skillNewCommand(opts: SkillNewOpts): Promise<void> {
  // AC-US3-12: prompt required
  if (opts.prompt === undefined || opts.prompt === null) {
    console.error(red("Error: ") + dim("--prompt is required."));
    console.error(
      dim("Usage: ") + cyan('vskill skill new --prompt "<description>"'),
    );
    exit(1);
  }
  const promptText = String(opts.prompt).trim();
  if (promptText.length === 0) {
    console.error(red("Error: ") + dim("--prompt cannot be empty."));
    console.error(
      dim("Usage: ") + cyan('vskill skill new --prompt "<description>"'),
    );
    exit(1);
  }

  const engine: EngineMode =
    opts.engine === "anthropic-skill-creator" ? "anthropic-skill-creator" : "universal";

  // Resolve targets up front so argument errors never leave a half-written
  // workspace (AC-US3-11: all-or-nothing).
  let targets: string[];
  if (engine === "anthropic-skill-creator") {
    // AC-US3-05: Claude-only emission under the skill-creator engine.
    targets = ["claude-code"];
  } else {
    const resolved = resolveTargets(opts.targets);
    if (!resolved.ok) {
      console.error(red("Error: ") + dim(resolved.error));
      exit(1);
    }
    targets = resolved.ids;
  }

  const cwd = process.cwd();

  // AC-US2-07: skill-creator fallback requires the Anthropic built-in.
  if (engine === "anthropic-skill-creator") {
    if (!isSkillCreatorInstalled(cwd)) {
      console.error(
        red("Error: ") +
          dim("--engine=anthropic-skill-creator requires skill-creator."),
      );
      console.error(dim("Remediation:"));
      console.error(dim("  Install vskill:         ") + cyan("npm i -g vskill"));
      console.error(
        dim("  Install skill-creator:  ") + cyan("claude plugin install skill-creator"),
      );
      exit(1);
    }
    // Stub delegation — a full implementation hands off to skill-creator.
    // Emitting with engine="anthropic-skill-creator" is the marker Chain D
    // reads to produce Claude-only output + fallback-mode divergence.
    console.error("[skill-builder] delegating to anthropic-skill-creator");
    console.error(
      "[skill-builder] fallback mode — universal targets not emitted; install vskill for universal support",
    );
  }

  let generated: GenerateSkillResult;
  if (engine === "anthropic-skill-creator") {
    // Skill-creator delegation path: synthesize a minimal GenerateSkillResult
    // so the emitter (Chain D) can still produce a Claude-only SKILL.md.
    generated = {
      name: slugifyPrompt(promptText),
      description: promptText.slice(0, 200),
      model: "",
      allowedTools: "",
      body: `# ${slugifyPrompt(promptText)}\n\n(Generated via anthropic-skill-creator.)\n`,
      evals: [],
      reasoning: "",
    };
  } else {
    generated = await generateSkill(
      { prompt: promptText, targetAgents: targets },
      { root: cwd },
    );
  }

  const result = emitSkillImpl(generated, { targetAgents: targets, engine });

  const slug = generated.name || "skill";
  const { filesWritten, reportPath } = writeEmittedFiles(cwd, result, slug);
  writeSentinel(cwd, "cli:skill:new", targets, promptText);

  console.log(green(`Emitted ${filesWritten} file(s) across ${targets.length} target(s).`));
  console.log(dim(`Divergences: ${result.divergences.length}`));
  console.log(dim(`Report: ${reportPath}`));
}

function slugifyPrompt(prompt: string): string {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);
  const slug = words.join("-");
  return slug || "skill";
}

// ---------------------------------------------------------------------------
// `vskill skill import`
// ---------------------------------------------------------------------------

interface SkillImportOpts {
  targets?: string;
}

async function skillImportCommand(
  skillPath: string,
  opts: SkillImportOpts,
): Promise<void> {
  const absPath = isAbsolute(skillPath) ? skillPath : resolve(process.cwd(), skillPath);
  if (!existsSync(absPath)) {
    console.error(red("Error: ") + dim(`File not found: ${skillPath}`));
    exit(1);
  }

  const resolved = resolveTargets(opts.targets);
  if (!resolved.ok) {
    console.error(red("Error: ") + dim(resolved.error));
    exit(1);
  }
  const targets = resolved.ids;

  const raw = readFileSync(absPath, "utf-8");
  const parsed = parseSkillMd(raw);

  const generated: GenerateSkillResult = {
    name: parsed.name,
    description: parsed.description,
    model: parsed.model,
    allowedTools: parsed.allowedTools,
    body: parsed.body,
    evals: [],
    reasoning: "",
  };

  const result = emitSkillImpl(generated, {
    targetAgents: targets,
    engine: "universal",
  });

  const cwd = process.cwd();
  const slug = generated.name || "skill";
  const { filesWritten, reportPath } = writeEmittedFiles(cwd, result, slug);
  writeSentinel(cwd, "cli:skill:import", targets, absPath);

  console.log(
    green(`Re-emitted ${filesWritten} file(s) across ${targets.length} target(s).`),
  );
  console.log(dim(`Divergences: ${result.divergences.length}`));
  console.log(dim(`Report: ${reportPath}`));
}

/**
 * Minimal SKILL.md parser — extracts frontmatter (the first `---`-fenced
 * YAML block) and body. We only care about a handful of canonical fields.
 * A full YAML parse is deliberately avoided to stay dependency-free here;
 * skill authors can rely on the full parser in src/installer/frontmatter.ts
 * once Chain D stabilizes.
 */
function parseSkillMd(raw: string): {
  name: string;
  description: string;
  model: string;
  allowedTools: string;
  body: string;
} {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const frontmatter = fmMatch ? fmMatch[1] : "";
  const body = fmMatch ? fmMatch[2] : raw;

  const fields: Record<string, string> = {};
  for (const line of frontmatter.split("\n")) {
    const m = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*)\s*:\s*(.+)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }

  // Name: prefer body heading, fall back to frontmatter name/slug.
  let name = fields.name ?? "";
  const headingMatch = body.match(/^#\s*\/?([a-z0-9][a-z0-9-]*)/m);
  if (headingMatch) name = headingMatch[1];
  if (!name) name = "imported-skill";

  return {
    name,
    description: fields.description ?? "",
    model: fields.model ?? "",
    allowedTools: fields["allowed-tools"] ?? "",
    body: body.trimStart(),
  };
}

// ---------------------------------------------------------------------------
// `vskill skill list | info | publish`
// ---------------------------------------------------------------------------

async function skillListCommand(): Promise<void> {
  await listCommand({});
}

async function skillInfoCommand(name: string): Promise<void> {
  const cwd = process.cwd();
  const candidates: string[] = [
    join(cwd, ".agents/skills", name, "SKILL.md"),
    ...AGENTS_REGISTRY.map((a) => join(cwd, a.localSkillsDir, name, "SKILL.md")),
  ];

  const skillMdPath = candidates.find((p) => existsSync(p));
  if (!skillMdPath) {
    console.error(red("Skill not found locally: ") + dim(name));
    console.error(
      dim("Searched: ") + cyan(`.agents/skills/${name}/SKILL.md`) + dim(" + agent-native dirs"),
    );
    exit(1);
  }

  const raw = readFileSync(skillMdPath, "utf-8");
  const parsed = parseSkillMd(raw);
  console.log(bold(`Skill: ${parsed.name}`));
  console.log(dim(`Path: ${skillMdPath}`));
  if (parsed.description) console.log(`Description: ${parsed.description}`);
  if (parsed.model) console.log(`Model: ${parsed.model}`);
  if (parsed.allowedTools) console.log(`Allowed tools: ${parsed.allowedTools}`);

  // Pull divergence report if it sits beside the SKILL.md.
  const reportPath = join(dirname(skillMdPath), `${parsed.name}-divergence.md`);
  if (existsSync(reportPath)) {
    console.log("");
    console.log(bold("Divergence report:"));
    console.log(readFileSync(reportPath, "utf-8"));
  } else {
    console.log(dim("\n(No divergence report beside SKILL.md.)"));
  }
}

async function skillPublishCommand(name: string): Promise<void> {
  // `vskill submit` takes a source (owner/repo) + --skill <name>, but
  // vskill skill publish is designed to publish an already-installed skill
  // whose owner/repo is recorded in the lockfile. Passing the name through
  // preserves the expected alias semantics — submit.ts either resolves it
  // via the lockfile (future work) or errors with the same UX the user
  // would see today.
  await submitCommand(name, {});
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerSkillCommand(program: Command): void {
  const skill = program
    .command("skill")
    .description("Skill-builder workflow: generate, import, publish universal skills");

  skill
    .command("new")
    .description("Generate a new skill from a natural-language prompt")
    .option("--prompt <text>", "Description of the skill to generate")
    .option(
      "--targets <list>",
      "Comma-separated agent ids, or 'all' (default: 8 universal agents)",
    )
    .option(
      "--engine <mode>",
      "Generator engine: 'universal' (default) or 'anthropic-skill-creator'",
    )
    .action(async (opts: SkillNewOpts) => {
      await skillNewCommand(opts);
    });

  skill
    .command("import <path>")
    .description("Re-emit an existing SKILL.md against the requested targets")
    .option(
      "--targets <list>",
      "Comma-separated agent ids, or 'all' (default: 8 universal agents)",
    )
    .action(async (path: string, opts: SkillImportOpts) => {
      await skillImportCommand(path, opts);
    });

  skill
    .command("list")
    .description("List installed skills (thin alias for 'vskill list')")
    .action(async () => {
      await skillListCommand();
    });

  skill
    .command("info <name>")
    .description("Show frontmatter + divergence report for an installed skill")
    .action(async (name: string) => {
      await skillInfoCommand(name);
    });

  skill
    .command("publish <name>")
    .description("Publish a skill for verification (alias for 'vskill submit')")
    .action(async (name: string) => {
      await skillPublishCommand(name);
    });
}
