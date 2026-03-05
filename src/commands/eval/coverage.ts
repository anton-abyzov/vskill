// ---------------------------------------------------------------------------
// vskill eval coverage -- show eval coverage across all skills
// ---------------------------------------------------------------------------

import { scanSkills } from "../../eval/skill-scanner.js";
import { loadAndValidateEvals } from "../../eval/schema.js";
import { readBenchmark } from "../../eval/benchmark.js";
import { green, red, yellow, cyan, bold, dim, table } from "../../utils/output.js";

export async function runEvalCoverage(root: string): Promise<void> {
  const skills = await scanSkills(root);

  if (skills.length === 0) {
    console.log(dim("No skills found in " + root));
    return;
  }

  const headers = ["PLUGIN", "SKILL", "CASES", "ASSERTIONS", "LAST RUN", "STATUS"];
  const rows: string[][] = [];

  let missing = 0;
  let pending = 0;
  let passing = 0;
  let failing = 0;

  for (const skill of skills) {
    if (!skill.hasEvals) {
      rows.push([skill.plugin, skill.skill, "-", "-", "-", yellow("MISSING")]);
      missing++;
      continue;
    }

    let evalsFile;
    try {
      evalsFile = loadAndValidateEvals(skill.dir);
    } catch {
      rows.push([skill.plugin, skill.skill, "-", "-", "-", red("INVALID")]);
      failing++;
      continue;
    }

    const caseCount = String(evalsFile.evals.length);
    const assertionCount = String(
      evalsFile.evals.reduce((sum, e) => sum + e.assertions.length, 0),
    );

    const benchmark = await readBenchmark(skill.dir);
    if (!benchmark) {
      rows.push([
        skill.plugin,
        skill.skill,
        caseCount,
        assertionCount,
        "-",
        cyan("PENDING"),
      ]);
      pending++;
      continue;
    }

    const anyFailed = benchmark.cases.some(
      (c) => c.status === "fail" || c.status === "error",
    );
    const lastRun = benchmark.timestamp.split("T")[0];

    if (anyFailed) {
      rows.push([
        skill.plugin,
        skill.skill,
        caseCount,
        assertionCount,
        lastRun,
        red("FAIL"),
      ]);
      failing++;
    } else {
      rows.push([
        skill.plugin,
        skill.skill,
        caseCount,
        assertionCount,
        lastRun,
        green("PASS"),
      ]);
      passing++;
    }
  }

  console.log(bold(`\nEval Coverage Report\n`));
  console.log(table(headers, rows));
  console.log(
    `\n${bold("Summary:")} ${skills.length} skills | ${green(`${passing} pass`)} | ${red(`${failing} fail`)} | ${cyan(`${pending} pending`)} | ${yellow(`${missing} missing`)}`,
  );
}
