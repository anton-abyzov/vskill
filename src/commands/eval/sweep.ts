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
  baseline?: boolean;
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
  const baseline = options.baseline ?? false;

  console.log(bold(`\nSweep: ${evalsFile.skill_name}`));
  console.log(dim(`Models: ${modelList.join(", ")}`));
  console.log(dim(`Judge: ${options.judge}`));
  console.log(dim(`Runs per model: ${runs}`));
  console.log(dim(`Cases: ${evalsFile.evals.length}`));
  if (baseline) console.log(dim(`Baseline: enabled (comparing with vs without skill)`));
  console.log("");

  // Warn about low run count
  if (runs < 3) {
    console.log(yellow(`Note: ${runs} run(s) may not produce statistically meaningful results. Use --runs 3+ for reliable ranking.\n`));
  }

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
    baseline,
  })) {
    switch (event.type) {
      case "sweep_judge_bias_warning":
        console.log(yellow(`WARNING: ${event.data.warning}\n`));
        break;

      case "sweep_model_start":
        process.stdout.write(dim(`[${event.data.modelIndex + 1}/${event.data.totalModels}] ${event.data.model} — `));
        break;

      case "sweep_model_progress": {
        const phaseLabel = event.data.phase === "baseline" ? " [baseline]" : "";
        process.stdout.write(dim(`\r[${event.data.model}${phaseLabel}] run ${event.data.run}/${event.data.totalRuns} case ${event.data.currentCase}/${event.data.totalCases} (${event.data.percentComplete}%)`));
        break;
      }

      case "sweep_model_complete":
        if (event.data.status === "complete" && event.data.passRate) {
          let summary = ` done (pass rate: ${(event.data.passRate.mean * 100).toFixed(1)}%)`;
          if (event.data.baselinePassRate && event.data.skillDelta) {
            const delta = event.data.skillDelta.mean * 100;
            const sign = delta >= 0 ? "+" : "";
            summary += ` | baseline: ${(event.data.baselinePassRate.mean * 100).toFixed(1)}% | delta: ${sign}${delta.toFixed(1)}pp`;
            if (event.data.amplificationPct != null && isFinite(event.data.amplificationPct)) {
              const ampSign = event.data.amplificationPct >= 0 ? "+" : "";
              summary += ` (${ampSign}${event.data.amplificationPct.toFixed(1)}%)`;
            }
          }
          console.log(green(summary));
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

  // Sort by composite score (if available) then by pass rate
  const sorted = [...sweepResult.models].sort((a, b) => {
    if (a.compositeScore != null && b.compositeScore != null) {
      return b.compositeScore - a.compositeScore;
    }
    return b.passRate.mean - a.passRate.mean;
  });

  // Build table based on whether baseline was used
  if (baseline) {
    const headers = ["RANK", "MODEL", "WITH SKILL", "WITHOUT SKILL", "DELTA", "AMPLIFICATION", "STATUS"];
    const rows = sorted.map((m, i) => [
      String(i + 1),
      `${m.provider}/${m.model}`,
      m.status === "complete" ? formatStats(m.passRate, true) : "-",
      m.status === "complete" && m.baselinePassRate ? formatStats(m.baselinePassRate, true) : "-",
      m.status === "complete" && m.skillDelta
        ? `${m.skillDelta.mean >= 0 ? "+" : ""}${(m.skillDelta.mean * 100).toFixed(1)}pp`
        : "-",
      m.status === "complete" && m.amplificationPct != null && isFinite(m.amplificationPct)
        ? `${m.amplificationPct >= 0 ? "+" : ""}${m.amplificationPct.toFixed(1)}%`
        : "-",
      m.status === "complete" ? green("OK") : red("ERR"),
    ]);

    console.log(bold("\nSweep Results (Skill Amplification)\n"));
    console.log(table(headers, rows));

    // Skill quality badge
    if (sweepResult.skillQualityScore != null && sweepResult.skillQualityRating) {
      const ratingColors: Record<string, (s: string) => string> = {
        excellent: green, good: green, marginal: yellow, minimal: yellow, harmful: red,
      };
      const colorFn = ratingColors[sweepResult.skillQualityRating] ?? dim;
      const sign = sweepResult.skillQualityScore >= 0 ? "+" : "";
      const label = `${sign}${sweepResult.skillQualityScore.toFixed(1)}% (${sweepResult.skillQualityRating.toUpperCase()})`;
      console.log(`\nSkill Quality: ${colorFn(label)}`);
    }
  } else {
    const headers = ["RANK", "MODEL", "PASS RATE", "DURATION", "COST", "STATUS"];
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
  }

  console.log(dim(`\nLeaderboard saved to ${skillDir}/evals/leaderboard/`));
}

function formatStats(stats: ModelStats, asPercent: boolean, suffix = ""): string {
  if (asPercent) {
    return `${(stats.mean * 100).toFixed(1)}%${stats.stddev > 0 ? ` (±${(stats.stddev * 100).toFixed(1)}%)` : ""}`;
  }
  return `${Math.round(stats.mean)}${suffix}${stats.stddev > 0 ? ` (±${Math.round(stats.stddev)}${suffix})` : ""}`;
}
