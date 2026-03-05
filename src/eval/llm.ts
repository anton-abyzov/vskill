// ---------------------------------------------------------------------------
// Anthropic LLM client wrapper for eval commands
// ---------------------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

export interface LlmClient {
  generate(systemPrompt: string, userPrompt: string): Promise<string>;
  readonly model: string;
}

export function createLlmClient(): LlmClient {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Export it before running eval commands:\n  export ANTHROPIC_API_KEY=sk-ant-...",
    );
  }

  const client = new Anthropic({ apiKey });
  const model = process.env.VSKILL_EVAL_MODEL || DEFAULT_MODEL;

  return {
    model,
    async generate(systemPrompt: string, userPrompt: string): Promise<string> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120_000);
      try {
        const response = await client.messages.create(
          {
            model,
            system: systemPrompt,
            messages: [{ role: "user", content: userPrompt }],
            max_tokens: 4096,
          },
          { signal: controller.signal },
        );

        const textBlock = response.content.find((b) => b.type === "text");
        return textBlock && "text" in textBlock ? textBlock.text : "";
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
