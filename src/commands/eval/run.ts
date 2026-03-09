// ---------------------------------------------------------------------------
// vskill eval run -- execute eval cases and grade assertions
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadAndValidateEvals, EvalValidationError } from "../../eval/schema.js";
import { createLlmClient } from "../../eval/llm.js";
import { judgeAssertion } from "../../eval/judge.js";
import { writeBenchmark } from "../../eval/benchmark.js";
import type { BenchmarkCase, BenchmarkResult } from "../../eval/benchmark.js";
import { green, red, yellow, bold, dim, table } from "../../utils/output.js";

export async function runEvalRun(skillDir: string): Promise<void> {
  // Load and validate evals.json
  let evalsFile;
  try {
    evalsFile = loadAndValidateEvals(skillDir);
  } catch (err) {
    if (err instanceof EvalValidationError) {
      const firstMsg = err.errors[0]?.message || "";
      if (firstMsg.includes("No evals.json")) {
        console.error(red(`No evals.json found at ${skillDir}/evals/evals.json`));
      } else {
        console.error(red(`Invalid evals.json: ${err.message}`));
      }
    } else {
      console.error(red(`Error loading evals: ${(err as Error).message}`));
    }
    process.exit(1);
    return;
  }

  // Load SKILL.md content for the system prompt
  const skillMdPath = join(skillDir, "SKILL.md");
  let skillContent = "";
  if (existsSync(skillMdPath)) {
    skillContent = readFileSync(skillMdPath, "utf-8");
  } else {
    console.error(yellow(`Warning: No SKILL.md found at ${skillMdPath} — running evals without skill content`));
  }

  const systemPrompt = skillContent
    ? `You are an AI assistant with the following skill loaded. Use this skill's knowledge to answer the user's question.\n\n---\n${skillContent}\n---`
    : "You are an AI assistant. Answer the user's question.";

  const client = createLlmClient();
  const model = client.model;
  const total = evalsFile.evals.length;
  console.log(dim(`Provider: ${model} | ${total} eval case${total !== 1 ? "s" : ""}`));
  console.log(dim(`Skill: ${skillContent ? skillMdPath : "(none)"}\n`));

  const benchmarkCases: BenchmarkCase[] = [];
  const tableRows: string[][] = [];

  for (let i = 0; i < evalsFile.evals.length; i++) {
    const evalCase = evalsFile.evals[i];
    try {
      // Step 1: Send prompt to LLM
      process.stdout.write(dim(`[${i + 1}/${total}] ${evalCase.name} — generating...`));
      const genResult = await client.generate(systemPrompt, evalCase.prompt);
      process.stdout.write(dim(` judging ${evalCase.assertions.length} assertions...`));

      // Step 2: Judge each assertion
      const assertionResults = [];
      let passCount = 0;

      for (const assertion of evalCase.assertions) {
        const result = await judgeAssertion(genResult.text, assertion, client);
        assertionResults.push(result);
        if (result.pass) passCount++;

        const truncatedText =
          assertion.text.length > 60
            ? assertion.text.slice(0, 57) + "..."
            : assertion.text;

        tableRows.push([
          evalCase.name,
          assertion.id,
          truncatedText,
          result.pass ? green("PASS") : red("FAIL"),
        ]);
      }

      const passRate = evalCase.assertions.length > 0
        ? passCount / evalCase.assertions.length
        : 0;
      const allPassed = passCount === evalCase.assertions.length;
      console.log(allPassed ? green(" done") : red(` ${passCount}/${evalCase.assertions.length} passed`));

      benchmarkCases.push({
        eval_id: evalCase.id,
        eval_name: evalCase.name,
        status: allPassed ? "pass" : "fail",
        error_message: null,
        pass_rate: passRate,
        assertions: assertionResults,
      });
    } catch (err) {
      console.log(yellow(" error"));
      benchmarkCases.push({
        eval_id: evalCase.id,
        eval_name: evalCase.name,
        status: "error",
        error_message: (err as Error).message,
        pass_rate: 0,
        assertions: [],
      });

      tableRows.push([
        evalCase.name,
        "-",
        dim("Error: " + (err as Error).message.slice(0, 50)),
        yellow("ERROR"),
      ]);
    }
  }

  // Print results table
  const headers = ["EVAL", "ASSERTION", "TEXT", "STATUS"];
  console.log(bold(`\nEval Results: ${evalsFile.skill_name}\n`));
  console.log(table(headers, tableRows));

  // Compute summary
  const passed = benchmarkCases.filter((c) => c.status === "pass").length;
  const failed = benchmarkCases.filter((c) => c.status === "fail").length;
  const errors = benchmarkCases.filter((c) => c.status === "error").length;
  console.log(
    `\n${green(`${passed} passed`)} ${failed > 0 ? red(`${failed} failed`) : ""} ${errors > 0 ? yellow(`${errors} errors`) : ""}`.trim(),
  );

  // Write benchmark.json
  const benchmark: BenchmarkResult = {
    timestamp: new Date().toISOString(),
    model,
    skill_name: evalsFile.skill_name,
    cases: benchmarkCases,
  };

  await writeBenchmark(skillDir, benchmark);
  console.log(dim(`\nBenchmark written to ${skillDir}/evals/benchmark.json`));
}
