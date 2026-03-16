// ---------------------------------------------------------------------------
// vskill eval sweep -- run evals across multiple models
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadAndValidateEvals, EvalValidationError } from "../../eval/schema.js";
import { buildEvalSystemPrompt } from "../../eval/prompt-builder.js";
import { runSweep } from "../../eval-server/sweep-runner.js";
import type { SweepResult, ModelResult, ModelStats } from "../../eval-server/sweep-runner.js";
import { green, red, yellow, bold, dim, table } from "../../utils/output.js";

export interface SweepOptions {
  models: string;
  judge: string;
  runs?: number;
  concurrency?: number;
}

export async function runEvalSweep(skillDir: string, options: SweepOptions): Promise<void> {
  // Load and validate evals.json
  let evalsFile;
  try {
    evalsFile = loadAndValidateEvals(skillDir);
  } catch (err) {
    if (err instanceof EvalValidationError) {
      console.error(red(`Invalid evals.json: ${err.message}`));
    } else {
      console.error(red(`Error loading evals: ${(err as Error).message}`));
    }
    process.exit(1);
    return;
  }

  const skillMdPath = join(skillDir, "SKILL.md");
  const skillContent = existsSync(skillMdPath) ? readFileSync(skillMdPath, "utf-8") : "";
  const systemPrompt = buildEvalSystemPrompt(skillContent);
  const modelList = options.models.split(",").map((m) => m.trim()).filter(Boolean);

  if (modelList.length === 0) {
    console.error(red("No models specified. Use --models 'provider/model,provider/model'"));
    process.exit(1);
    return;
  }

  const runs = options.runs ?? 1;
  const concurrency = options.concurrency ?? 5;

  console.log(bold(`\nSweep: ${evalsFile.skill_name}`));
  console.log(dim(`Models: ${modelList.join(", ")}`));
  console.log(dim(`Judge: ${options.judge}`));
  console.log(dim(`Runs per model: ${runs}`));
  console.log(dim(`Cases: ${evalsFile.evals.length}\n`));

  let sweepResult: SweepResult | null = null;

  for await (const event of runSweep({
    skillDir,
    skillName: evalsFile.skill_name,
    systemPrompt,
    evalCases: evalsFile.evals,
    models: modelList,
    judge: options.judge,
    runs,
    concurrency,
  })) {
    switch (event.type) {
      case "sweep_model_start":
        process.stdout.write(dim(`[${event.data.modelIndex + 1}/${event.data.totalModels}] ${event.data.model} — `));
        break;

      case "sweep_model_progress":
        process.stdout.write(dim(`\r[${event.data.model}] run ${event.data.run}/${event.data.totalRuns} case ${event.data.currentCase}/${event.data.totalCases} (${event.data.percentComplete}%)`));
        break;

      case "sweep_model_complete":
        if (event.data.status === "complete" && event.data.passRate) {
          console.log(green(` done`) + dim(` (pass rate: ${(event.data.passRate.mean * 100).toFixed(1)}%)`));
        } else {
          console.log(red(` error: ${event.data.errorMessage || "unknown"}`));
        }
        break;

      case "sweep_complete":
        sweepResult = event.data;
        break;
    }
  }

  if (!sweepResult) {
    console.error(red("\nSweep failed to produce results."));
    process.exit(1);
    return;
  }

  // Print summary table
  const headers = ["RANK", "MODEL", "PASS RATE", "DURATION", "COST", "STATUS"];
  const sorted = [...sweepResult.models].sort((a, b) => b.passRate.mean - a.passRate.mean);
  const rows = sorted.map((m, i) => [
    String(i + 1),
    `${m.provider}/${m.model}`,
    m.status === "complete" ? formatStats(m.passRate, true) : "-",
    m.status === "complete" ? formatStats(m.duration, false, "ms") : "-",
    m.cost.total > 0 ? `$${m.cost.total.toFixed(4)}` : "-",
    m.status === "complete" ? green("OK") : red("ERR"),
  ]);

  console.log(bold("\nSweep Results\n"));
  console.log(table(headers, rows));
  console.log(dim(`\nLeaderboard saved to ${skillDir}/evals/leaderboard/`));
}

function formatStats(stats: ModelStats, asPercent: boolean, suffix = ""): string {
  if (asPercent) {
    return `${(stats.mean * 100).toFixed(1)}%${stats.stddev > 0 ? ` (±${(stats.stddev * 100).toFixed(1)}%)` : ""}`;
  }
  return `${Math.round(stats.mean)}${suffix}${stats.stddev > 0 ? ` (±${Math.round(stats.stddev)}${suffix})` : ""}`;
}
