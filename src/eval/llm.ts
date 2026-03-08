// ---------------------------------------------------------------------------
// LLM client for eval commands — supports Claude CLI, Anthropic API, and Ollama
//
// Provider selection via VSKILL_EVAL_PROVIDER env var:
//   "claude-cli" — Claude Code CLI (uses your Max/Pro plan, no API key)
//   "anthropic"  — Anthropic API (requires ANTHROPIC_API_KEY)
//   "ollama"     — Local Ollama server (free, requires ollama running)
//
// Auto-detection when VSKILL_EVAL_PROVIDER is not set:
//   1. Inside Claude Code session (CLAUDECODE env) → ollama
//   2. ANTHROPIC_API_KEY present → anthropic
//   3. Otherwise → claude-cli (default for plain terminal)
//
// Model selection via VSKILL_EVAL_MODEL env var:
//   claude-cli:  "sonnet" | "opus" | "haiku" (default: sonnet)
//   anthropic:   full model ID (default: claude-sonnet-4-20250514)
//   ollama:      model name (default: llama3.1:8b)
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";

export interface LlmClient {
  generate(systemPrompt: string, userPrompt: string): Promise<string>;
  readonly model: string;
}

type ProviderName = "anthropic" | "claude-cli" | "ollama";

function detectProvider(): ProviderName {
  if (process.env.CLAUDECODE) return "ollama";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "claude-cli";
}

export function createLlmClient(): LlmClient {
  const provider = (process.env.VSKILL_EVAL_PROVIDER || detectProvider()) as ProviderName;

  switch (provider) {
    case "anthropic":
      return createAnthropicClient();
    case "claude-cli":
      return createClaudeCliClient();
    case "ollama":
      return createOllamaClient();
    default:
      throw new Error(
        `Unknown VSKILL_EVAL_PROVIDER: "${provider}". Use "claude-cli", "anthropic", or "ollama".`,
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
//
// Pipes prompt via stdin to avoid OS argument-length limits (ARG_MAX).
//
// From a plain terminal: npx vskill eval run mobile/appstore
// Select model:          VSKILL_EVAL_MODEL=opus npx vskill eval run mobile/appstore
// ---------------------------------------------------------------------------
function createClaudeCliClient(): LlmClient {
  if (process.env.CLAUDECODE) {
    throw new Error(
      "Cannot use claude-cli provider inside a Claude Code session.\nRun from a plain terminal, or use a different provider:\n  export VSKILL_EVAL_PROVIDER=ollama",
    );
  }

  const model = process.env.VSKILL_EVAL_MODEL || "sonnet";

  return {
    model: `claude-${model}`,
    async generate(systemPrompt: string, userPrompt: string): Promise<string> {
      const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;

      return new Promise<string>((resolve, reject) => {
        const proc = spawn("claude", ["-p", "--model", model], {
          stdio: ["pipe", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
        proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

        const timer = setTimeout(() => {
          proc.kill("SIGTERM");
          reject(new Error("Claude CLI timed out after 120s"));
        }, 120_000);

        proc.on("error", (err: NodeJS.ErrnoException) => {
          clearTimeout(timer);
          if (err.code === "ENOENT") {
            reject(new Error(
              "Claude CLI not found. Install it:\n  npm install -g @anthropic-ai/claude-code\n\nOr use a different provider:\n  export VSKILL_EVAL_PROVIDER=ollama",
            ));
          } else {
            reject(new Error(`Claude CLI failed: ${err.message}`));
          }
        });

        proc.on("close", (code) => {
          clearTimeout(timer);
          if (code === 0) {
            resolve(stdout.trim());
          } else {
            const errMsg = (stderr || stdout).slice(0, 300);
            reject(new Error(`Claude CLI exited with code ${code}${errMsg ? ": " + errMsg : ""}`));
          }
        });

        // Pipe prompt via stdin — avoids ARG_MAX limits for large SKILL.md files
        proc.stdin.end(combinedPrompt);
      });
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
