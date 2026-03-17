// ---------------------------------------------------------------------------
// vskill eval -- subcommand router
// ---------------------------------------------------------------------------

import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { red, dim } from "../utils/output.js";

export async function evalCommand(
  subcommand: string,
  target?: string,
  opts: { force?: boolean; type?: string; root?: string; port?: string; credentialKey?: string; concurrency?: string; judgeModel?: string; noCache?: boolean; cache?: boolean; models?: string; judge?: string; runs?: string; batch?: boolean; baseline?: boolean } = {},
): Promise<void> {
  const root = opts.root ? resolve(opts.root) : resolve(".");

  switch (subcommand) {
    case "serve": {
      const port = opts.port ? parseInt(opts.port, 10) : null;
      const { runEvalServe } = await import("./eval/serve.js");
      return runEvalServe(root, port);
    }

    case "init": {
      if (!target) {
        console.error(red("Usage: vskill eval init <plugin>/<skill>"));
        process.exit(1);
      }
      const skillDir = resolveSkillDir(root, target);
      const { runEvalInit } = await import("./eval/init.js");
      const evalType = (opts.type === "integration" || opts.type === "all") ? opts.type : "unit";
      return runEvalInit(skillDir, !!opts.force, evalType);
    }

    case "run": {
      if (!target) {
        console.error(red("Usage: vskill eval run <plugin>/<skill>"));
        process.exit(1);
      }
      const skillDir = resolveSkillDir(root, target);
      const { runEvalRun } = await import("./eval/run.js");
      // Commander uses --no-cache to set cache=false (noCache is undefined)
      const noCache = opts.noCache === true || opts.cache === false;
      return runEvalRun(skillDir, {
        concurrency: opts.concurrency ? parseInt(opts.concurrency, 10) : undefined,
        judgeModel: opts.judgeModel,
        noCache,
        batch: opts.batch,
      });
    }

    case "coverage": {
      const { runEvalCoverage } = await import("./eval/coverage.js");
      return runEvalCoverage(root);
    }

    case "generate-all": {
      const { runEvalGenerateAll } = await import("./eval/generate-all.js");
      const batchConcurrency = opts.concurrency ? parseInt(opts.concurrency, 10) : undefined;
      return runEvalGenerateAll(root, !!opts.force, batchConcurrency);
    }

    case "sweep": {
      if (!target) {
        console.error(red("Usage: vskill eval sweep <plugin>/<skill> --models '...' --judge '...'"));
        process.exit(1);
      }
      if (!opts.models) {
        console.error(red("--models flag is required (comma-separated, e.g., 'anthropic/claude-sonnet-4,openrouter/meta-llama/llama-3.1-70b')"));
        process.exit(1);
      }
      if (!opts.judge) {
        console.error(red("--judge flag is required (e.g., 'anthropic/claude-sonnet-4')"));
        process.exit(1);
      }
      const skillDir = resolveSkillDir(root, target);
      const { runEvalSweep } = await import("./eval/sweep.js");
      return runEvalSweep(skillDir, {
        models: opts.models,
        judge: opts.judge,
        runs: opts.runs ? parseInt(opts.runs, 10) : undefined,
        concurrency: opts.concurrency ? parseInt(opts.concurrency, 10) : undefined,
        baseline: opts.baseline,
      });
    }

    case "credentials": {
      if (!target) {
        console.error(red("Usage: vskill credentials <set|list|check> [plugin/skill] [KEY]"));
        process.exit(1);
      }
      // target is the sub-subcommand: set, list, check
      // For credentials, we use CWD as skillDir (or --root)
      const credSkillDir = root;
      const { runCredentialsSet, runCredentialsList, runCredentialsCheck } = await import("./eval/credentials.js");
      switch (target) {
        case "set": {
          const key = opts.credentialKey;
          if (!key) {
            console.error(red("Usage: vskill credentials set <KEY>"));
            process.exit(1);
          }
          return runCredentialsSet(credSkillDir, key);
        }
        case "list":
          return runCredentialsList(credSkillDir);
        case "check":
          return runCredentialsCheck(credSkillDir);
        default:
          console.error(red(`Unknown credentials subcommand: "${target}"\n`) + dim("Available: set, list, check"));
      }
      break;
    }

    default:
      console.error(
        red(`Unknown subcommand: "${subcommand}"\n`) +
          dim("Available: serve, init, run, sweep, coverage, generate-all, credentials"),
      );
  }
}

function resolveSkillDir(root: string, target: string): string {
  const parts = target.split("/");
  if (parts.length !== 2) {
    console.error(
      red(`Invalid target "${target}". Expected format: <plugin>/<skill>`),
    );
    process.exit(1);
  }

  // Try direct layout: {root}/{plugin}/skills/{skill}/
  const directPath = join(root, parts[0], "skills", parts[1]);
  if (existsSync(directPath)) return directPath;

  // Try nested plugins/ layout: {root}/plugins/{plugin}/skills/{skill}/
  const nestedPath = join(root, "plugins", parts[0], "skills", parts[1]);
  if (existsSync(nestedPath)) return nestedPath;

  // Try root layout: {root}/skills/{skill}/
  const rootPath = join(root, "skills", parts[1]);
  if (existsSync(rootPath)) return rootPath;

  // Default to direct layout (let downstream error on missing SKILL.md)
  return directPath;
}
