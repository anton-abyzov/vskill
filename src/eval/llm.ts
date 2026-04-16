// ---------------------------------------------------------------------------
// LLM client for eval commands — supports multiple CLI tools and API providers
//
// Provider selection via VSKILL_EVAL_PROVIDER env var:
//   "claude-cli" — Claude Code CLI (uses your Max/Pro plan, no API key)
//   "codex-cli"  — OpenAI Codex CLI (uses ChatGPT subscription or CODEX_API_KEY)
//   "gemini-cli" — Google Gemini CLI (free tier or GOOGLE_API_KEY)
//   "anthropic"  — Anthropic API (requires ANTHROPIC_API_KEY)
//   "ollama"     — Local Ollama server (free, requires ollama running)
//
// Auto-detection when VSKILL_EVAL_PROVIDER is not set:
//   1. claude-cli (default — works everywhere, even inside Claude Code sessions)
//   Other providers only used when explicitly set via VSKILL_EVAL_PROVIDER
//
// Timeout via VSKILL_EVAL_TIMEOUT env var (seconds, default: 300):
//   export VSKILL_EVAL_TIMEOUT=600   # 10 minutes for complex cases
//
// Model selection via VSKILL_EVAL_MODEL env var:
//   claude-cli:  "sonnet" | "opus" | "haiku" (default: sonnet)
//   codex-cli:   "o4-mini" | "codex-1" | "gpt-5.3-codex" (default: o4-mini)
//   gemini-cli:  "gemini-2.5-pro" | "gemini-2.5-flash" (default: gemini-2.5-pro)
//   anthropic:   full model ID (default: claude-sonnet-4-6)
//   ollama:      model name (default: llama3.1:8b)
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import { resolveCliBinary, enhancedPath } from "../utils/resolve-binary.js";
import { calculateCost, getBillingMode } from "./pricing.js";

export type BillingMode = "per-token" | "subscription" | "free";

export interface GenerateResult {
  text: string;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cost: number | null;
  billingMode: BillingMode;
}

export interface LlmClient {
  generate(systemPrompt: string, userPrompt: string): Promise<GenerateResult>;
  readonly model: string;
}

export type ProviderName = "anthropic" | "claude-cli" | "codex-cli" | "gemini-cli" | "ollama" | "openrouter";

function detectProvider(): ProviderName {
  return "claude-cli";
}

/** Timeout in ms — configurable via VSKILL_EVAL_TIMEOUT (seconds). Default: 300s */
function getTimeoutMs(): number {
  const envVal = process.env.VSKILL_EVAL_TIMEOUT;
  if (envVal) {
    const seconds = parseInt(envVal, 10);
    if (!isNaN(seconds) && seconds > 0) return seconds * 1000;
  }
  return 300_000;
}

export interface LlmOverrides {
  provider?: ProviderName;
  model?: string;
}

/**
 * Estimate total eval duration in seconds based on provider and workload.
 * Each case requires 1 generate call + N judge calls (one per assertion).
 */
export function estimateDurationSec(
  provider: ProviderName,
  totalCases: number,
  totalAssertions: number,
): { minSec: number; maxSec: number; label: string } {
  // Approximate seconds per LLM call by provider
  const perCall: Record<ProviderName, [number, number]> = {
    "claude-cli":  [12, 30],
    "anthropic":   [4, 12],
    "codex-cli":   [8, 20],
    "gemini-cli":  [8, 20],
    "ollama":      [5, 30],
    "openrouter":  [4, 15],
  };
  const [lo, hi] = perCall[provider] ?? [5, 20];
  const totalCalls = totalCases + totalAssertions; // 1 generate + N judges
  const minSec = Math.round(totalCalls * lo);
  const maxSec = Math.round(totalCalls * hi);

  const fmt = (s: number) => s >= 60 ? `${Math.round(s / 60)}m` : `${s}s`;
  const label = minSec === maxSec ? fmt(minSec) : `${fmt(minSec)}–${fmt(maxSec)}`;
  return { minSec, maxSec, label };
}

export function createLlmClient(overrides?: LlmOverrides): LlmClient {
  const provider = (overrides?.provider || process.env.VSKILL_EVAL_PROVIDER || detectProvider()) as ProviderName;
  const modelOverride = overrides?.model;
  switch (provider) {
    case "anthropic":
      return createAnthropicClient(modelOverride);
    case "claude-cli":
      return createClaudeCliClient(modelOverride);
    case "codex-cli":
      return createCodexCliClient(modelOverride);
    case "gemini-cli":
      return createGeminiCliClient(modelOverride);
    case "ollama":
      return createOllamaClient(modelOverride);
    case "openrouter":
      return createOpenRouterClient(modelOverride);
    default:
      throw new Error(
        `Unknown VSKILL_EVAL_PROVIDER: "${provider}". Use "claude-cli", "codex-cli", "gemini-cli", "anthropic", "ollama", or "openrouter".`,
      );
  }
}

// ---------------------------------------------------------------------------
// Model normalization — prevents cross-provider model ID leaks.
// e.g. "claude-sonnet" (a displayModel artifact) → "sonnet" for CLI,
//      "sonnet" (CLI shorthand) → "claude-sonnet-4-6" for Anthropic API.
// ---------------------------------------------------------------------------
const CLAUDE_CLI_NORMALIZE: Record<string, string> = {
  "claude-sonnet": "sonnet",
  "claude-opus": "opus",
  "claude-haiku": "haiku",
  "claude-sonnet-4-6": "sonnet",
  "claude-sonnet-4-20250514": "sonnet",
  "claude-opus-4-7": "opus",
  "claude-opus-4-6": "opus",
  "claude-opus-4-20250514": "opus",
  "claude-haiku-4-5-20251001": "haiku",
};

const ANTHROPIC_NORMALIZE: Record<string, string> = {
  "sonnet": "claude-sonnet-4-6",
  "opus": "claude-opus-4-7",
  "haiku": "claude-haiku-4-5-20251001",
  "claude-sonnet": "claude-sonnet-4-6",
  "claude-opus": "claude-opus-4-7",
  "claude-haiku": "claude-haiku-4-5-20251001",
};

function normalizeClaudeCliModel(model: string): string {
  return CLAUDE_CLI_NORMALIZE[model] || model;
}

function normalizeAnthropicModel(model: string): string {
  return ANTHROPIC_NORMALIZE[model] || model;
}

// ---------------------------------------------------------------------------
// Provider: Anthropic API
// ---------------------------------------------------------------------------
function createAnthropicClient(modelOverride?: string): LlmClient {
  const DEFAULT_MODEL = "claude-sonnet-4-6";

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Export it before running eval commands:\n  export ANTHROPIC_API_KEY=sk-ant-...\n\nOr use a different provider:\n  export VSKILL_EVAL_PROVIDER=claude-cli   # uses your Claude Max plan\n  export VSKILL_EVAL_PROVIDER=ollama       # uses local Ollama",
    );
  }

  const raw = modelOverride || process.env.VSKILL_EVAL_MODEL || DEFAULT_MODEL;
  const model = normalizeAnthropicModel(raw);
  let clientInstance: any = null;

  return {
    model,
    async generate(systemPrompt: string, userPrompt: string): Promise<GenerateResult> {
      if (!clientInstance) {
        const { default: Anthropic } = await import("@anthropic-ai/sdk");
        clientInstance = new Anthropic({ apiKey });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), getTimeoutMs());
      const start = Date.now();
      try {
        const response = await clientInstance.messages.create(
          {
            model,
            system: systemPrompt,
            messages: [{ role: "user", content: userPrompt }],
            max_tokens: 4096,
          },
          { signal: controller.signal },
        );
        const durationMs = Date.now() - start;

        const textBlock = response.content.find((b: any) => b.type === "text");
        const text = textBlock && "text" in textBlock ? textBlock.text : "";
        const inputTokens = response.usage?.input_tokens ?? null;
        const outputTokens = response.usage?.output_tokens ?? null;
        return {
          text,
          durationMs,
          inputTokens,
          outputTokens,
          cost: calculateCost("anthropic", model, inputTokens, outputTokens),
          billingMode: getBillingMode("anthropic"),
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Shared CLI spawn helper — all CLI providers use the same pattern:
//   1. Spawn binary with args
//   2. Pipe combined prompt via stdin (avoids ARG_MAX for large SKILL.md files)
//   3. Collect stdout, handle ENOENT/non-zero exit/timeout
// ---------------------------------------------------------------------------
interface CliConfig {
  binary: string;
  name: string; // Human-readable name for error messages (e.g. "Claude", "Codex")
  args: string[];
  displayModel: string;
  notFoundMsg: string;
  stripEnvPrefix?: string; // e.g. "CLAUDE" — strips env vars starting with this prefix
  provider: string; // provider ID for billing mode lookup
}

function createCliClient(config: CliConfig): LlmClient {
  // Resolve binary path once at client creation time (cached internally)
  const resolvedBinary = resolveCliBinary(config.binary);
  // Pre-compute enhanced PATH once — avoids repeated execSync per generate() call
  const cachedEnhancedPath = enhancedPath();

  return {
    model: config.displayModel,
    async generate(systemPrompt: string, userPrompt: string): Promise<GenerateResult> {
      const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
      const start = Date.now();

      const text = await new Promise<string>((resolve, reject) => {
        // Build env: strip prefix vars if needed, always use enhanced PATH
        let env: Record<string, string>;
        if (config.stripEnvPrefix) {
          env = {};
          const prefix = config.stripEnvPrefix;
          for (const [k, v] of Object.entries(process.env)) {
            if (v !== undefined && !k.startsWith(prefix)) env[k] = v;
          }
        } else {
          env = { ...process.env as Record<string, string> };
        }
        env.PATH = cachedEnhancedPath;

        // On Windows, .cmd/.bat files require shell:true to execute via spawn
        const needsShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(resolvedBinary);

        const proc = spawn(resolvedBinary, config.args, {
          stdio: ["pipe", "pipe", "pipe"],
          env,
          ...(needsShell ? { shell: true } : {}),
        });

        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
        proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

        const timeoutMs = getTimeoutMs();
        const timer = setTimeout(() => {
          proc.kill("SIGTERM");
          reject(new Error(`${config.name} CLI timed out after ${timeoutMs / 1000}s`));
        }, timeoutMs);

        proc.on("error", (err: NodeJS.ErrnoException) => {
          clearTimeout(timer);
          if (err.code === "ENOENT") {
            reject(new Error(config.notFoundMsg));
          } else {
            reject(new Error(`${config.name} CLI failed: ${err.message}`));
          }
        });

        proc.on("close", (code) => {
          clearTimeout(timer);
          if (code === 0) {
            resolve(stdout.trim());
          } else {
            const errMsg = (stderr || stdout).slice(0, 300);
            reject(new Error(
              `${config.name} CLI exited with code ${code}${errMsg ? ": " + errMsg : ""}`,
            ));
          }
        });

        proc.stdin.end(combinedPrompt);
      });

      return { text, durationMs: Date.now() - start, inputTokens: null, outputTokens: null, cost: null, billingMode: getBillingMode(config.provider) };
    },
  };
}

// ---------------------------------------------------------------------------
// Provider: Claude CLI (uses your Max/Pro subscription — no API key needed)
// Strips CLAUDE* env vars so the child process doesn't detect nesting.
// ---------------------------------------------------------------------------
function createClaudeCliClient(modelOverride?: string): LlmClient {
  const raw = modelOverride || process.env.VSKILL_EVAL_MODEL || "sonnet";
  const model = normalizeClaudeCliModel(raw);
  return createCliClient({
    binary: "claude",
    name: "Claude",
    args: ["-p", "--model", model],
    displayModel: model,
    stripEnvPrefix: "CLAUDE",
    provider: "claude-cli",
    notFoundMsg:
      "Claude CLI not found. Install it:\n  npm install -g @anthropic-ai/claude-code\n\nOr use a different provider:\n  export VSKILL_EVAL_PROVIDER=ollama",
  });
}

// ---------------------------------------------------------------------------
// Provider: Codex CLI (uses your ChatGPT subscription — or CODEX_API_KEY for CI)
// ---------------------------------------------------------------------------
function createCodexCliClient(modelOverride?: string): LlmClient {
  const model = modelOverride || process.env.VSKILL_EVAL_MODEL || "o4-mini";
  return createCliClient({
    binary: "codex",
    name: "Codex",
    args: ["exec", "--model", model],
    displayModel: `codex-${model}`,
    provider: "codex-cli",
    notFoundMsg:
      "Codex CLI not found. Install it:\n  npm install -g @openai/codex\n\nOr use a different provider:\n  export VSKILL_EVAL_PROVIDER=claude-cli",
  });
}

// ---------------------------------------------------------------------------
// Provider: Gemini CLI (free tier — 60 req/min, 1000 req/day, or GOOGLE_API_KEY)
// NOTE: Gemini CLI headless flags are provisional — verify against actual binary.
// ---------------------------------------------------------------------------
function createGeminiCliClient(modelOverride?: string): LlmClient {
  const model = modelOverride || process.env.VSKILL_EVAL_MODEL || "gemini-2.5-pro";
  return createCliClient({
    binary: "gemini",
    name: "Gemini",
    args: ["-p", "--model", model],
    displayModel: model,
    provider: "gemini-cli",
    notFoundMsg:
      "Gemini CLI not found. Install it:\n  npm install -g @google/gemini-cli\n\nOr use a different provider:\n  export VSKILL_EVAL_PROVIDER=claude-cli",
  });
}

// ---------------------------------------------------------------------------
// Provider: Ollama (local models — free, no API key)
// ---------------------------------------------------------------------------
function createOllamaClient(modelOverride?: string): LlmClient {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const model = modelOverride || process.env.VSKILL_EVAL_MODEL || "llama3.1:8b";

  return {
    model,
    async generate(systemPrompt: string, userPrompt: string): Promise<GenerateResult> {
      const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
      const start = Date.now();

      const response = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt: fullPrompt,
          stream: false,
          options: {
            num_predict: 4096,
            temperature: 0.3,
          },
        }),
        signal: AbortSignal.timeout(getTimeoutMs()),
      });

      if (!response.ok) {
        const error = await response.text();
        if (error.includes("model") && error.includes("not found")) {
          throw new Error(
            `Ollama model "${model}" not found. Pull it first:\n  ollama pull ${model}`,
          );
        }
        throw new Error(`Ollama request failed: ${error}`);
      }

      const data = (await response.json()) as {
        response?: string;
        prompt_eval_count?: number;
        eval_count?: number;
      };
      return {
        text: data.response || "",
        durationMs: Date.now() - start,
        inputTokens: data.prompt_eval_count ?? null,
        outputTokens: data.eval_count ?? null,
        cost: 0,
        billingMode: "free" as const,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Provider: OpenRouter (100+ models via single API key)
// ---------------------------------------------------------------------------
function createOpenRouterClient(modelOverride?: string): LlmClient {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Visit https://openrouter.ai/keys to get your key, then run:\n  export OPENROUTER_API_KEY=<your-key>",
    );
  }

  const model = modelOverride || process.env.VSKILL_EVAL_MODEL || "anthropic/claude-sonnet-4";

  return {
    model,
    async generate(systemPrompt: string, userPrompt: string): Promise<GenerateResult> {
      const start = Date.now();

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
          "HTTP-Referer": "https://verified-skill.com",
          "X-Title": "vSkill Studio",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_tokens: 4096,
        }),
        signal: AbortSignal.timeout(getTimeoutMs()),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenRouter request failed (${response.status}): ${error}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_cost?: number;
        };
      };

      const text = data.choices?.[0]?.message?.content || "";
      const inputTokens = data.usage?.prompt_tokens ?? null;
      const outputTokens = data.usage?.completion_tokens ?? null;
      const apiCost = data.usage?.total_cost ?? null;
      return {
        text,
        durationMs: Date.now() - start,
        inputTokens,
        outputTokens,
        cost: apiCost ?? calculateCost("openrouter", model, inputTokens, outputTokens),
        billingMode: "per-token" as const,
      };
    },
  };
}
