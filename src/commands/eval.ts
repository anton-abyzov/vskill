// ---------------------------------------------------------------------------
// vskill eval -- subcommand router
// ---------------------------------------------------------------------------

import { join, resolve } from "node:path";
import { red, dim } from "../utils/output.js";

export async function evalCommand(
  subcommand: string,
  target?: string,
  opts: { force?: boolean; root?: string } = {},
): Promise<void> {
  const root = opts.root ? resolve(opts.root) : resolve("plugins");

  switch (subcommand) {
    case "init": {
      if (!target) {
        console.error(red("Usage: vskill eval init <plugin>/<skill>"));
        process.exit(1);
      }
      const skillDir = resolveSkillDir(root, target);
      const { runEvalInit } = await import("./eval/init.js");
      return runEvalInit(skillDir, !!opts.force);
    }

    case "run": {
      if (!target) {
        console.error(red("Usage: vskill eval run <plugin>/<skill>"));
        process.exit(1);
      }
      const skillDir = resolveSkillDir(root, target);
      const { runEvalRun } = await import("./eval/run.js");
      return runEvalRun(skillDir);
    }

    case "coverage": {
      const { runEvalCoverage } = await import("./eval/coverage.js");
      return runEvalCoverage(root);
    }

    case "generate-all": {
      const { runEvalGenerateAll } = await import("./eval/generate-all.js");
      return runEvalGenerateAll(root, !!opts.force);
    }

    default:
      console.error(
        red(`Unknown subcommand: "${subcommand}"\n`) +
          dim("Available: init, run, coverage, generate-all"),
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
  return join(root, parts[0], "skills", parts[1]);
}
