// ---------------------------------------------------------------------------
// batch-judge.ts -- Anthropic Message Batches API for eval judge calls
//
// Collects all judge prompts into a single batch request, polls for completion
// with escalating intervals, maps results back to AssertionResult[].
// Falls back to sequential judgeAssertion() on any failure.
// ---------------------------------------------------------------------------

import type { Assertion } from "./schema.js";
import type { AssertionResult } from "./judge.js";
import { buildJudgeSystemPrompt, judgeAssertion } from "./judge.js";
import type { LlmClient } from "./llm.js";
import type { McpDependency } from "./mcp-detector.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BatchJudgeRequest {
  evalId: string;
  assertionIdx: number;
  assertion: Assertion;
  output: string;
  mcpDeps?: McpDependency[];
}

interface BatchRequestItem {
  custom_id: string;
  params: {
    model: string;
    max_tokens: number;
    system: string;
    messages: Array<{ role: "user"; content: string }>;
  };
}

export interface BatchJudgeOptions {
  apiKey: string;
  model?: string;
  minBatchSize?: number;
}

// ---------------------------------------------------------------------------
// Polling configuration
// ---------------------------------------------------------------------------

const POLL_INTERVAL_INITIAL_MS = 5_000;   // 0-60s: every 5s
const POLL_INTERVAL_MEDIUM_MS = 15_000;   // 60s-5min: every 15s
const POLL_INTERVAL_SLOW_MS = 30_000;     // 5min+: every 30s
const POLL_ESCALATE_1_MS = 60_000;        // escalate from 5s to 15s after 60s
const POLL_ESCALATE_2_MS = 300_000;       // escalate from 15s to 30s after 5min
const POLL_TIMEOUT_MS = 600_000;          // 10 minutes total timeout

/** Minimum batch size — below this, sequential is faster than batch overhead */
const DEFAULT_MIN_BATCH_SIZE = 5;

// ---------------------------------------------------------------------------
// Build judge user prompt (mirrors judge.ts format)
// ---------------------------------------------------------------------------

function buildJudgeUserPrompt(output: string, assertionText: string): string {
  return `## LLM Output
${output}

## Assertion to Verify
${assertionText}

Does the LLM output satisfy this assertion? Respond with JSON only: { "pass": boolean, "reasoning": "..." }`;
}

// ---------------------------------------------------------------------------
// Parse a single judge response from batch result
// ---------------------------------------------------------------------------

function parseJudgeResponse(raw: string): { pass: boolean; reasoning: string } {
  const fenceMatch = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  const jsonStr = fenceMatch ? fenceMatch[1] : raw;

  try {
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed.pass !== "boolean") {
      throw new Error("missing pass field");
    }
    return {
      pass: parsed.pass,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    };
  } catch {
    throw new Error(
      `Invalid judge output: expected JSON with { pass, reasoning }, got: ${raw.slice(0, 100)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Get polling interval based on elapsed time
// ---------------------------------------------------------------------------

export function getPollInterval(elapsedMs: number): number {
  if (elapsedMs < POLL_ESCALATE_1_MS) return POLL_INTERVAL_INITIAL_MS;
  if (elapsedMs < POLL_ESCALATE_2_MS) return POLL_INTERVAL_MEDIUM_MS;
  return POLL_INTERVAL_SLOW_MS;
}

// ---------------------------------------------------------------------------
// Build batch request items from judge requests
// ---------------------------------------------------------------------------

function buildBatchItems(
  requests: BatchJudgeRequest[],
  model: string,
): BatchRequestItem[] {
  return requests.map((req) => {
    const customId = `${req.evalId}_${req.assertionIdx}`;
    const systemPrompt = buildJudgeSystemPrompt(req.mcpDeps);
    const userPrompt = buildJudgeUserPrompt(req.output, req.assertion.text);

    return {
      custom_id: customId,
      params: {
        model,
        max_tokens: 256,
        system: systemPrompt,
        messages: [{ role: "user" as const, content: userPrompt }],
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Map batch results back to AssertionResult[]
// ---------------------------------------------------------------------------

function mapBatchResults(
  results: Map<string, { pass: boolean; reasoning: string }>,
  requests: BatchJudgeRequest[],
): AssertionResult[] {
  return requests.map((req) => {
    const customId = `${req.evalId}_${req.assertionIdx}`;
    const parsed = results.get(customId);

    if (!parsed) {
      return {
        id: req.assertion.id,
        text: req.assertion.text,
        pass: false,
        reasoning: `No batch result found for custom_id: ${customId}`,
      };
    }

    return {
      id: req.assertion.id,
      text: req.assertion.text,
      pass: parsed.pass,
      reasoning: parsed.reasoning,
    };
  });
}

// ---------------------------------------------------------------------------
// Sequential fallback — uses existing judgeAssertion() one at a time
// ---------------------------------------------------------------------------

async function sequentialFallback(
  requests: BatchJudgeRequest[],
  client: LlmClient,
  judgeClient: LlmClient,
): Promise<AssertionResult[]> {
  const results: AssertionResult[] = [];
  for (const req of requests) {
    const result = await judgeAssertion(
      req.output,
      req.assertion,
      client,
      judgeClient,
      req.mcpDeps,
    );
    results.push(result);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Poll batch status with escalating intervals
// ---------------------------------------------------------------------------

async function pollBatchCompletion(
  anthropicClient: any,
  batchId: string,
): Promise<void> {
  const startTime = Date.now();

  while (true) {
    const elapsed = Date.now() - startTime;

    if (elapsed >= POLL_TIMEOUT_MS) {
      // Timeout — attempt to cancel the batch
      try {
        await anthropicClient.messages.batches.cancel(batchId);
      } catch {
        // Ignore cancel errors — we're throwing timeout anyway
      }
      throw new Error(
        `Batch ${batchId} timed out after ${POLL_TIMEOUT_MS / 1000}s. Batch was cancelled.`,
      );
    }

    const interval = getPollInterval(elapsed);
    await new Promise((resolve) => setTimeout(resolve, interval));

    const status = await anthropicClient.messages.batches.retrieve(batchId);

    if (status.processing_status === "ended") {
      return;
    }

    if (status.processing_status === "canceling") {
      throw new Error(`Batch ${batchId} is being cancelled.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Retrieve and parse batch results
// ---------------------------------------------------------------------------

async function retrieveBatchResults(
  anthropicClient: any,
  batchId: string,
): Promise<Map<string, { pass: boolean; reasoning: string }>> {
  const resultMap = new Map<string, { pass: boolean; reasoning: string }>();

  for await (const entry of anthropicClient.messages.batches.results(batchId)) {
    const customId: string = entry.custom_id;

    if (entry.result?.type === "succeeded") {
      const message = entry.result.message;
      const textBlock = message?.content?.find((b: any) => b.type === "text");
      const raw = textBlock?.text || "";

      try {
        const parsed = parseJudgeResponse(raw);
        resultMap.set(customId, parsed);
      } catch {
        resultMap.set(customId, {
          pass: false,
          reasoning: `Failed to parse judge response: ${raw.slice(0, 100)}`,
        });
      }
    } else {
      const errorType = entry.result?.type || "unknown";
      const errorMsg = entry.result?.error?.message || "No error details";
      resultMap.set(customId, {
        pass: false,
        reasoning: `Batch item ${errorType}: ${errorMsg}`,
      });
    }
  }

  return resultMap;
}

// ---------------------------------------------------------------------------
// Calculate batch cost with 50% discount
// ---------------------------------------------------------------------------

export interface BatchCostInfo {
  batchCost: number;
  sequentialCost: number;
  savings: number;
}

export function calculateBatchCost(
  inputTokens: number,
  outputTokens: number,
  model: string,
): BatchCostInfo {
  // Per-token pricing (per 1M tokens) for common Anthropic models
  const pricing: Record<string, { input: number; output: number }> = {
    "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
    "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
    "claude-haiku-4-5-20251001": { input: 0.80, output: 4.0 },
    "claude-opus-4-7": { input: 5.0, output: 25.0 },
    "claude-opus-4-6": { input: 5.0, output: 25.0 },
  };

  // Default to sonnet pricing if model not found
  const modelPricing = pricing[model] || pricing["claude-sonnet-4-6"];

  const sequentialCost =
    (inputTokens / 1_000_000) * modelPricing.input +
    (outputTokens / 1_000_000) * modelPricing.output;

  const batchCost = sequentialCost * 0.5; // 50% batch discount
  const savings = sequentialCost - batchCost;

  return { batchCost, sequentialCost, savings };
}

// ---------------------------------------------------------------------------
// Main entry point: batchJudgeAssertions()
// ---------------------------------------------------------------------------

export async function batchJudgeAssertions(
  requests: BatchJudgeRequest[],
  client: LlmClient,
  judgeClient: LlmClient,
  options: BatchJudgeOptions,
): Promise<{ results: AssertionResult[]; costInfo: BatchCostInfo | null }> {
  const minBatchSize = options.minBatchSize ?? DEFAULT_MIN_BATCH_SIZE;

  // Below minimum batch size, sequential is faster
  if (requests.length < minBatchSize) {
    const results = await sequentialFallback(requests, client, judgeClient);
    return { results, costInfo: null };
  }

  const model = options.model || "claude-sonnet-4-6";
  const batchItems = buildBatchItems(requests, model);

  let anthropicClient: any;
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    anthropicClient = new Anthropic({ apiKey: options.apiKey });
  } catch (err) {
    console.warn(
      `Warning: Failed to initialize Anthropic client for batch: ${(err as Error).message}. Falling back to sequential.`,
    );
    const results = await sequentialFallback(requests, client, judgeClient);
    return { results, costInfo: null };
  }

  try {
    // T-021: Submit batch request
    const batch = await anthropicClient.messages.batches.create({
      requests: batchItems,
    });

    // T-022: Poll for completion
    await pollBatchCompletion(anthropicClient, batch.id);

    // T-023: Retrieve and map results
    const rawResults = await retrieveBatchResults(anthropicClient, batch.id);
    const results = mapBatchResults(rawResults, requests);

    // T-027: Calculate cost from batch response counts
    const totalInputTokens = batch.request_counts?.succeeded
      ? requests.length * 500  // Estimate ~500 input tokens per judge call
      : 0;
    const totalOutputTokens = batch.request_counts?.succeeded
      ? (batch.request_counts.succeeded as number) * 50  // Estimate ~50 output tokens per judge response
      : 0;

    const costInfo = calculateBatchCost(totalInputTokens, totalOutputTokens, model);

    return { results, costInfo };
  } catch (err) {
    // T-024: Sequential fallback on any batch failure
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(
      `Warning: Batch judge failed: ${errMsg}. Falling back to sequential judge calls.`,
    );
    const results = await sequentialFallback(requests, client, judgeClient);
    return { results, costInfo: null };
  }
}
