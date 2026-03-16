// ---------------------------------------------------------------------------
// vskill eval init -- scaffold evals.json for a skill using LLM
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createLlmClient } from "../../eval/llm.js";
import {
  buildEvalInitPrompt,
  buildIntegrationEvalPrompt,
  parseGeneratedEvals,
  parseGeneratedIntegrationEvals,
  detectBrowserRequirements,
  detectPlatformTargets,
} from "../../eval/prompt-builder.js";
import { detectMcpDependencies } from "../../eval/mcp-detector.js";
import { green, red, dim, yellow } from "../../utils/output.js";

export type EvalInitType = "unit" | "integration" | "all";

export async function runEvalInit(
  skillDir: string,
  force: boolean,
  type: EvalInitType = "unit",
): Promise<void> {
  const skillMdPath = join(skillDir, "SKILL.md");
  const evalsDir = join(skillDir, "evals");
  const evalsPath = join(evalsDir, "evals.json");

  // Check SKILL.md exists
  if (!existsSync(skillMdPath)) {
    console.error(red(`SKILL.md not found at ${skillMdPath}`));
    return;
  }

  // Check existing evals.json
  if (existsSync(evalsPath) && !force) {
    console.log(
      yellow("evals.json already exists, use --force to overwrite"),
    );
    return;
  }

  const skillContent = readFileSync(skillMdPath, "utf-8");

  // Detect integration capabilities
  const mcpDeps = detectMcpDependencies(skillContent);
  const browserReqs = detectBrowserRequirements(skillContent);
  const platforms = detectPlatformTargets(skillContent);
  const hasIntegrationTargets = mcpDeps.length > 0 || browserReqs.hasBrowser;

  // AC-US3-05: No integration targets + --type integration → skip
  if (type === "integration" && !hasIntegrationTargets) {
    console.log(dim("No integration targets detected, generating unit tests only"));
    return;
  }

  try {
    if (type === "all" && hasIntegrationTargets) {
      // AC-US3-04: Parallel dispatch — unit (Haiku) + integration (Sonnet)
      const unitPrompt = buildEvalInitPrompt(skillContent);
      const integrationPrompt = buildIntegrationEvalPrompt(skillContent, mcpDeps, browserReqs, platforms);

      const unitClient = createLlmClient({ model: "haiku" });
      const integrationClient = createLlmClient({ model: "sonnet" });

      const [unitResult, integrationResult] = await Promise.allSettled([
        unitClient.generate(
          "You generate eval test cases for AI skills. Output only valid JSON in a code fence.",
          unitPrompt,
        ),
        integrationClient.generate(
          "You generate integration eval test cases for AI skills. Output only valid JSON in a code fence.",
          integrationPrompt,
        ),
      ]);

      const unitCases = unitResult.status === "fulfilled"
        ? parseGeneratedEvals(unitResult.value.text).evals
        : [];
      const integrationCases = integrationResult.status === "fulfilled"
        ? parseGeneratedIntegrationEvals(integrationResult.value.text)
        : [];

      if (unitResult.status === "rejected") {
        console.log(yellow(`Unit eval generation failed: ${unitResult.reason}`));
      }
      if (integrationResult.status === "rejected") {
        console.log(yellow(`Integration eval generation failed: ${integrationResult.reason}`));
      }

      const allCases = [...unitCases, ...integrationCases];
      if (allCases.length === 0) {
        console.error(red("Both unit and integration eval generation failed"));
        return;
      }

      // Extract skill name from unit result or derive from directory
      const skillName = unitResult.status === "fulfilled"
        ? parseGeneratedEvals(unitResult.value.text).skill_name
        : skillDir.split("/").pop() || "unknown";

      const evalsFile = { skill_name: skillName, evals: allCases };
      mkdirSync(evalsDir, { recursive: true });
      writeFileSync(evalsPath, JSON.stringify(evalsFile, null, 2), "utf-8");

      const unitCount = unitCases.length;
      const intgCount = integrationCases.length;
      console.log(green(`Created ${evalsPath}`));
      console.log(
        dim(`  ${unitCount} unit + ${intgCount} integration cases, ${allCases.reduce((sum, e) => sum + (e.assertions?.length || 0), 0)} assertions`),
      );
    } else if (type === "integration") {
      // Integration only
      const integrationPrompt = buildIntegrationEvalPrompt(skillContent, mcpDeps, browserReqs, platforms);
      const client = createLlmClient({ model: "sonnet" });
      const genResult = await client.generate(
        "You generate integration eval test cases for AI skills. Output only valid JSON in a code fence.",
        integrationPrompt,
      );

      const integrationCases = parseGeneratedIntegrationEvals(genResult.text);
      const skillName = skillDir.split("/").pop() || "unknown";
      const evalsFile = { skill_name: skillName, evals: integrationCases };

      mkdirSync(evalsDir, { recursive: true });
      writeFileSync(evalsPath, JSON.stringify(evalsFile, null, 2), "utf-8");

      console.log(green(`Created ${evalsPath}`));
      console.log(
        dim(`  ${integrationCases.length} integration cases, ${integrationCases.reduce((sum, e) => sum + (e.assertions?.length || 0), 0)} assertions`),
      );
    } else {
      // Unit only (default, existing behavior)
      const prompt = buildEvalInitPrompt(skillContent);
      const client = createLlmClient();
      const genResult = await client.generate(
        "You generate eval test cases for AI skills. Output only valid JSON in a code fence.",
        prompt,
      );

      const evalsFile = parseGeneratedEvals(genResult.text);

      mkdirSync(evalsDir, { recursive: true });
      writeFileSync(evalsPath, JSON.stringify(evalsFile, null, 2), "utf-8");

      console.log(green(`Created ${evalsPath}`));
      console.log(
        dim(`  ${evalsFile.evals.length} eval cases, ${evalsFile.evals.reduce((sum, e) => sum + e.assertions.length, 0)} assertions`),
      );
    }
  } catch (err) {
    console.error(
      red("Failed to generate evals: ") + dim((err as Error).message),
    );
  }
}
