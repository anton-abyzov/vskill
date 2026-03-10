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
// Model selection via VSKILL_EVAL_MODEL env var:
//   claude-cli:  "sonnet" | "opus" | "haiku" (default: sonnet)
//   codex-cli:   "o4-mini" | "codex-1" | "gpt-5.3-codex" (default: o4-mini)
//   gemini-cli:  "gemini-2.5-pro" | "gemini-2.5-flash" (default: gemini-2.5-pro)
//   anthropic:   full model ID (default: claude-sonnet-4-6)
//   ollama:      model name (default: llama3.1:8b)
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";

export interface GenerateResult {
  text: string;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface LlmClient {
  generate(systemPrompt: string, userPrompt: string): Promise<GenerateResult>;
  readonly model: string;
}

export type ProviderName = "anthropic" | "claude-cli" | "codex-cli" | "gemini-cli" | "ollama";

function detectProvider(): ProviderName {
  return "claude-cli";
}

export interface LlmOverrides {
  provider?: ProviderName;
  model?: string;
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
    default:
      throw new Error(
        `Unknown VSKILL_EVAL_PROVIDER: "${provider}". Use "claude-cli", "codex-cli", "gemini-cli", "anthropic", or "ollama".`,
      );
  }
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

  const model = modelOverride || process.env.VSKILL_EVAL_MODEL || DEFAULT_MODEL;
  let clientInstance: any = null;

  return {
    model,
    async generate(systemPrompt: string, userPrompt: string): Promise<GenerateResult> {
      if (!clientInstance) {
        const { default: Anthropic } = await import("@anthropic-ai/sdk");
        clientInstance = new Anthropic({ apiKey });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120_000);
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
        return {
          text,
          durationMs,
          inputTokens: response.usage?.input_tokens ?? null,
          outputTokens: response.usage?.output_tokens ?? null,
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
}

function createCliClient(config: CliConfig): LlmClient {
  return {
    model: config.displayModel,
    async generate(systemPrompt: string, userPrompt: string): Promise<GenerateResult> {
      const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;
      const start = Date.now();

      const text = await new Promise<string>((resolve, reject) => {
        let env: Record<string, string> | undefined;
        if (config.stripEnvPrefix) {
          env = {};
          const prefix = config.stripEnvPrefix;
          for (const [k, v] of Object.entries(process.env)) {
            if (v !== undefined && !k.startsWith(prefix)) env[k] = v;
          }
        }

        const proc = spawn(config.binary, config.args, {
          stdio: ["pipe", "pipe", "pipe"],
          ...(env ? { env } : {}),
        });

        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
        proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

        const timer = setTimeout(() => {
          proc.kill("SIGTERM");
          reject(new Error(`${config.name} CLI timed out after 120s`));
        }, 120_000);

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

      return { text, durationMs: Date.now() - start, inputTokens: null, outputTokens: null };
    },
  };
}

// ---------------------------------------------------------------------------
// Provider: Claude CLI (uses your Max/Pro subscription — no API key needed)
// Strips CLAUDE* env vars so the child process doesn't detect nesting.
// ---------------------------------------------------------------------------
function createClaudeCliClient(modelOverride?: string): LlmClient {
  const model = modelOverride || process.env.VSKILL_EVAL_MODEL || "sonnet";
  return createCliClient({
    binary: "claude",
    name: "Claude",
    args: ["-p", "--model", model],
    displayModel: `claude-${model}`,
    stripEnvPrefix: "CLAUDE",
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
        signal: AbortSignal.timeout(120_000),
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
      };
    },
  };
}
