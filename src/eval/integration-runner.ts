// ---------------------------------------------------------------------------
// integration-runner.ts -- 5-phase browser-based integration test runner
//
// Phases: Preflight -> Connect -> Execute -> Verify -> Cleanup
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { resolveCredential, resolveAllCredentials } from "./credential-resolver.js";
import { resolveProfile } from "./chrome-profile.js";
import { PlatformRateLimiter } from "./rate-limiter.js";
import { judgeAssertion } from "./judge.js";
import { createLlmClient } from "./llm.js";
import type { LlmClient } from "./llm.js";
import type {
  IntegrationPhase,
  PhaseResult,
  IntegrationRunResult,
  IntegrationEvalCase,
  IntegrationRunOpts,
} from "./integration-types.js";

// ---------------------------------------------------------------------------
// SIGINT cleanup state
// ---------------------------------------------------------------------------
let cleanupRegistered = false;
let cleanupFn: (() => Promise<void>) | null = null;
let cleanupDone = false;

function registerSigintHandler(fn: () => Promise<void>): void {
  cleanupFn = fn;
  cleanupDone = false;
  if (!cleanupRegistered) {
    process.on("SIGINT", sigintHandler);
    cleanupRegistered = true;
  }
}

function deregisterSigintHandler(): void {
  process.removeListener("SIGINT", sigintHandler);
  cleanupRegistered = false;
  cleanupFn = null;
}

async function sigintHandler(): Promise<void> {
  if (cleanupDone) return;
  cleanupDone = true;
  console.log("\nSIGINT received — running cleanup...");
  if (cleanupFn) {
    try {
      await cleanupFn();
      console.log("Cleanup complete, exiting.");
    } catch (err) {
      console.error("Cleanup failed:", (err as Error).message);
    }
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Playwright lazy check
// ---------------------------------------------------------------------------

export function checkPlaywright(): void {
  try {
    const require = createRequire(import.meta.url);
    require.resolve("playwright");
  } catch {
    throw new Error(
      "Playwright is required for integration tests. Install it with:\n" +
      "  npm install --save-dev playwright && npx playwright install chromium",
    );
  }
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

export async function runIntegrationCase(
  evalCase: IntegrationEvalCase,
  opts: IntegrationRunOpts,
): Promise<IntegrationRunResult> {
  const runId = opts.runId ?? randomUUID().slice(0, 8).toUpperCase();
  const testPrefix = `[VSKILL-TEST-${runId}]`;
  const phases: PhaseResult[] = [];
  const testArtifactIds: string[] = [runId];
  let browser: any = null;
  let context: any = null;

  // Register cleanup for SIGINT
  registerSigintHandler(async () => {
    await runCleanup(evalCase, browser, testArtifactIds);
  });

  try {
    // -----------------------------------------------------------------------
    // Phase 1: PREFLIGHT
    // -----------------------------------------------------------------------
    const preflightResult = await runPhase("preflight", async () => {
      // Check credentials
      if (evalCase.requiredCredentials?.length) {
        const statuses = resolveAllCredentials(evalCase.requiredCredentials, opts.skillDir);
        const missing = statuses.filter((s) => s.status === "missing");
        if (missing.length > 0) {
          throw new Error(
            `Missing credentials: ${missing.map((m) => m.name).join(", ")}. ` +
            `Set them with: vskill credentials set <KEY>`,
          );
        }
      }

      // Check Chrome profile
      const profileName = evalCase.requirements?.chromeProfile;
      const profilePath = evalCase.requirements?.chromeProfilePath;
      if (profileName && !profilePath) {
        resolveProfile(profileName);
      }

      // Check Playwright
      if (!opts.dryRun) {
        checkPlaywright();
      }
    });
    phases.push(preflightResult);

    if (preflightResult.status === "fail") {
      // Abort remaining phases
      for (const p of ["connect", "execute", "verify", "cleanup"] as IntegrationPhase[]) {
        phases.push({ phase: p, status: "skipped" });
      }
      return buildResult(evalCase, runId, phases, testArtifactIds, !!opts.dryRun);
    }

    // -----------------------------------------------------------------------
    // Phase 2: CONNECT
    // -----------------------------------------------------------------------
    const connectResult = await runPhase("connect", async () => {
      if (opts.dryRun) {
        console.log(`[DRY RUN] Would launch browser with profile: ${evalCase.requirements?.chromeProfile ?? "default"}`);
        return;
      }

      const profileName = evalCase.requirements?.chromeProfile;
      const profilePath = evalCase.requirements?.chromeProfilePath ?? (profileName ? resolveProfile(profileName) : undefined);

      const pw = await import("playwright");
      if (profilePath) {
        context = await pw.chromium.launchPersistentContext(profilePath, {
          headless: false,
          args: ["--disable-blink-features=AutomationControlled"],
        });
        browser = null; // persistent context manages its own browser
      } else {
        browser = await pw.chromium.launch({ headless: false });
        context = await browser.newContext();
      }
    });
    phases.push(connectResult);

    if (connectResult.status === "fail") {
      phases.push({ phase: "execute", status: "skipped" });
      phases.push({ phase: "verify", status: "skipped" });
      phases.push(await runPhase("cleanup", () => runCleanup(evalCase, browser ?? context, testArtifactIds)));
      return buildResult(evalCase, runId, phases, testArtifactIds, !!opts.dryRun);
    }

    // -----------------------------------------------------------------------
    // Phase 3: EXECUTE
    // -----------------------------------------------------------------------
    let generatedOutput = "";
    const executeResult = await runPhase("execute", async () => {
      const platform = evalCase.requirements?.platform;

      // Rate limiting
      if (platform && !opts.dryRun) {
        const rateLimiter = new PlatformRateLimiter(
          evalCase.requirements?.rateLimit
            ? { [platform]: evalCase.requirements.rateLimit }
            : undefined,
        );
        await rateLimiter.acquire(platform);
      }

      // Build prompt with test prefix
      const promptWithPrefix = `${testPrefix}\n\nIMPORTANT: All content you create or post MUST include the prefix "${testPrefix}" for identification and cleanup.\n\n${evalCase.prompt}`;

      if (opts.dryRun) {
        console.log(`[DRY RUN] Would execute LLM with prompt:\n${promptWithPrefix.slice(0, 200)}...`);
        generatedOutput = `[DRY RUN] Simulated output for: ${evalCase.name}`;
        return;
      }

      // Create LLM client and generate
      const client = createLlmClient();
      const skillMdPath = join(opts.skillDir, "SKILL.md");
      let systemPrompt = "You are executing an integration test. Follow the instructions precisely.";
      if (existsSync(skillMdPath)) {
        systemPrompt = readFileSync(skillMdPath, "utf-8");
      }

      const result = await client.generate(systemPrompt, promptWithPrefix);
      generatedOutput = result.text;
    });
    phases.push(executeResult);

    if (executeResult.status === "fail") {
      phases.push({ phase: "verify", status: "skipped" });
      phases.push(await runPhase("cleanup", () => runCleanup(evalCase, browser ?? context, testArtifactIds)));
      return buildResult(evalCase, runId, phases, testArtifactIds, !!opts.dryRun);
    }

    // -----------------------------------------------------------------------
    // Phase 4: VERIFY
    // -----------------------------------------------------------------------
    const verifyResult = await runPhase("verify", async () => {
      if (!evalCase.assertions?.length) return;

      const client = createLlmClient();
      const results = await Promise.all(
        evalCase.assertions.map((assertion) =>
          judgeAssertion(generatedOutput, assertion, client),
        ),
      );

      const failed = results.filter((r) => !r.pass);
      if (failed.length > 0) {
        throw new Error(
          `${failed.length} assertion(s) failed:\n` +
          failed.map((f) => `  - ${f.text}: ${f.reasoning}`).join("\n"),
        );
      }
    });
    phases.push(verifyResult);

    // -----------------------------------------------------------------------
    // Phase 5: CLEANUP
    // -----------------------------------------------------------------------
    const cleanupResult = await runPhase("cleanup", () =>
      runCleanup(evalCase, browser ?? context, testArtifactIds),
    );
    phases.push(cleanupResult);

    return buildResult(evalCase, runId, phases, testArtifactIds, !!opts.dryRun);
  } finally {
    deregisterSigintHandler();
  }
}

// ---------------------------------------------------------------------------
// Phase executor
// ---------------------------------------------------------------------------

async function runPhase(
  phase: IntegrationPhase,
  fn: () => Promise<void>,
): Promise<PhaseResult> {
  const start = Date.now();
  try {
    await fn();
    return { phase, status: "pass", durationMs: Date.now() - start };
  } catch (err) {
    return {
      phase,
      status: "fail",
      durationMs: Date.now() - start,
      errorMessage: (err as Error).message,
    };
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function runCleanup(
  evalCase: IntegrationEvalCase,
  browserOrContext: any,
  _testArtifactIds: string[],
): Promise<void> {
  // Run cleanup actions defined in the eval case
  if (evalCase.cleanup?.length) {
    for (const action of evalCase.cleanup) {
      try {
        if (action.execute) {
          await action.execute();
        }
      } catch (err) {
        // Log but do not throw — test result stands independently
        console.error(`Cleanup action "${action.description}" failed:`, (err as Error).message);
      }
    }
  }

  // Close browser
  if (browserOrContext) {
    try {
      await browserOrContext.close();
    } catch {
      // Browser may already be closed
    }
  }
}

// ---------------------------------------------------------------------------
// Confirmation prompt
// ---------------------------------------------------------------------------

export async function promptConfirmation(
  platform: string,
  actions: string[],
): Promise<boolean> {
  // Skip in CI
  if (process.env.CI === "true") return true;

  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const actionList = actions.map((a) => `  - ${a}`).join("\n");
  const question = `\nThis will perform the following actions on ${platform}:\n${actionList}\n\nProceed? (y/N) `;

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

/**
 * Check if this is the first run against a platform (no history file).
 */
export function isFirstRun(skillDir: string): boolean {
  return !existsSync(join(skillDir, "evals", ".integration-history.json"));
}

/**
 * Record a run in the integration history file.
 */
export function recordRun(skillDir: string, result: IntegrationRunResult): void {
  const historyPath = join(skillDir, "evals", ".integration-history.json");
  let history: IntegrationRunResult[] = [];
  if (existsSync(historyPath)) {
    try {
      history = JSON.parse(readFileSync(historyPath, "utf-8"));
    } catch {
      history = [];
    }
  }
  history.push(result);
  writeFileSync(historyPath, JSON.stringify(history, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildResult(
  evalCase: IntegrationEvalCase,
  runId: string,
  phases: PhaseResult[],
  testArtifactIds: string[],
  dryRun: boolean,
): IntegrationRunResult {
  const overallPass = phases.every((p) => p.status === "pass" || p.status === "skipped");
  return {
    evalId: String(evalCase.id),
    runId,
    phases,
    overallPass,
    testArtifactIds,
    dryRun,
  };
}
