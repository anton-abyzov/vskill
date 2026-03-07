// ---------------------------------------------------------------------------
// LLM client for eval commands — supports Anthropic API, Claude CLI, and Ollama
//
// Provider selection via VSKILL_EVAL_PROVIDER env var:
//   "anthropic"  — Anthropic API (requires ANTHROPIC_API_KEY)
//   "claude-cli"  — Claude Code CLI (uses your Max/Pro plan, no API key)
//   "ollama"     — Local Ollama server (free, requires ollama running)
//
// Defaults to "claude-cli" if no provider is set (zero-config local usage).
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface LlmClient {
  generate(systemPrompt: string, userPrompt: string): Promise<string>;
  readonly model: string;
}

type ProviderName = "anthropic" | "claude-cli" | "ollama";

export function createLlmClient(): LlmClient {
  const provider = (process.env.VSKILL_EVAL_PROVIDER || "claude-cli") as ProviderName;

  switch (provider) {
    case "anthropic":
      return createAnthropicClient();
    case "claude-cli":
      return createClaudeCliClient();
    case "ollama":
      return createOllamaClient();
    default:
      throw new Error(
        `Unknown VSKILL_EVAL_PROVIDER: "${provider}". Use "anthropic", "claude-cli", or "ollama".`,
      );
  }
}

// ---------------------------------------------------------------------------
// Provider: Anthropic API
// ---------------------------------------------------------------------------
function createAnthropicClient(): LlmClient {
  const DEFAULT_MODEL = "claude-sonnet-4-20250514";

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Export it before running eval commands:\n  export ANTHROPIC_API_KEY=sk-ant-...\n\nOr use a different provider:\n  export VSKILL_EVAL_PROVIDER=claude-cli   # uses your Claude Max plan\n  export VSKILL_EVAL_PROVIDER=ollama       # uses local Ollama",
    );
  }

  const model = process.env.VSKILL_EVAL_MODEL || DEFAULT_MODEL;
  let clientInstance: any = null;

  return {
    model,
    async generate(systemPrompt: string, userPrompt: string): Promise<string> {
      if (!clientInstance) {
        const { default: Anthropic } = await import("@anthropic-ai/sdk");
        clientInstance = new Anthropic({ apiKey });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120_000);
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

        const textBlock = response.content.find((b: any) => b.type === "text");
        return textBlock && "text" in textBlock ? textBlock.text : "";
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Provider: Claude CLI (uses your Max/Pro subscription — no API key needed)
// ---------------------------------------------------------------------------
function createClaudeCliClient(): LlmClient {
  const model = process.env.VSKILL_EVAL_MODEL || "claude-cli";

  return {
    model,
    async generate(systemPrompt: string, userPrompt: string): Promise<string> {
      const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;

      try {
        const { stdout } = await execFileAsync(
          "claude",
          ["-p", combinedPrompt, "--no-input"],
          { timeout: 120_000, maxBuffer: 1024 * 1024 },
        );
        return stdout.trim();
      } catch (err: any) {
        if (err.code === "ENOENT") {
          throw new Error(
            "Claude CLI not found. Install it:\n  npm install -g @anthropic-ai/claude-code\n\nOr use a different provider:\n  export VSKILL_EVAL_PROVIDER=anthropic\n  export VSKILL_EVAL_PROVIDER=ollama",
          );
        }
        throw new Error(`Claude CLI failed: ${err.message}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Provider: Ollama (local models — free, no API key)
// ---------------------------------------------------------------------------
function createOllamaClient(): LlmClient {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const model = process.env.VSKILL_EVAL_MODEL || "llama3.1:8b";

  return {
    model,
    async generate(systemPrompt: string, userPrompt: string): Promise<string> {
      const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

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

      const data = (await response.json()) as { response?: string };
      return data.response || "";
    },
  };
}
