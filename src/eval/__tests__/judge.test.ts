import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Assertion } from "../schema.js";
import type { LlmClient } from "../llm.js";
import { judgeAssertion, buildJudgeSystemPrompt } from "../judge.js";
import type { McpDependency } from "../mcp-detector.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockResult(text: string) {
  return { text, durationMs: 100, inputTokens: null, outputTokens: null };
}

function mockClient(response: string): LlmClient {
  return { generate: vi.fn().mockResolvedValue(mockResult(response)), model: "test-model" };
}

const ASSERTION: Assertion = {
  id: "assert-1",
  text: "Output mentions a file path",
  type: "boolean",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("judgeAssertion", () => {
  it("returns pass result when LLM judge says pass", async () => {
    const client = mockClient(
      JSON.stringify({ pass: true, reasoning: "output contains file path" }),
    );

    const result = await judgeAssertion(
      "The report has been saved to reports/q1.csv",
      ASSERTION,
      client,
    );

    expect(result.pass).toBe(true);
    expect(result.reasoning).toBe("output contains file path");
    expect(result.id).toBe("assert-1");
    expect(result.text).toBe("Output mentions a file path");
  });

  it("returns fail result when LLM judge says fail", async () => {
    const client = mockClient(
      JSON.stringify({
        pass: false,
        reasoning: "no file path found in output",
      }),
    );

    const result = await judgeAssertion("Hello world", ASSERTION, client);

    expect(result.pass).toBe(false);
    expect(result.reasoning).toBe("no file path found in output");
  });

  it("throws on malformed judge response", async () => {
    const client = mockClient("This is not JSON");

    await expect(
      judgeAssertion("some output", ASSERTION, client),
    ).rejects.toThrow(/invalid judge output/i);
  });

  it("handles JSON wrapped in code fence", async () => {
    const client = mockClient(
      '```json\n{"pass": true, "reasoning": "looks good"}\n```',
    );

    const result = await judgeAssertion("some output", ASSERTION, client);
    expect(result.pass).toBe(true);
  });

  it("uses standard prompt when mcpDeps not provided", async () => {
    const client = mockClient(
      JSON.stringify({ pass: true, reasoning: "ok" }),
    );

    await judgeAssertion("output", ASSERTION, client);

    const systemPrompt = (client.generate as any).mock.calls[0][0];
    expect(systemPrompt).toContain("binary assertion evaluator");
    expect(systemPrompt).not.toContain("SIMULATION MODE");
  });

  it("uses MCP-augmented prompt when mcpDeps provided", async () => {
    const client = mockClient(
      JSON.stringify({ pass: true, reasoning: "simulation valid" }),
    );

    const mcpDeps: McpDependency[] = [
      {
        server: "Slack",
        url: "https://mcp.slack.com/mcp",
        transport: "http",
        matchedTools: ["slack_send_message"],
        configSnippet: "{}",
      },
    ];

    await judgeAssertion("output", ASSERTION, client, mcpDeps);

    const systemPrompt = (client.generate as any).mock.calls[0][0];
    expect(systemPrompt).toContain("SIMULATION MODE");
    expect(systemPrompt).toContain("Slack");
  });
  // ---------------------------------------------------------------------------
  // TC-006: judgeClient overrides generation client
  // ---------------------------------------------------------------------------

  it("uses judgeClient when provided instead of generation client (TC-006)", async () => {
    const generationClient = mockClient(
      JSON.stringify({ pass: false, reasoning: "should not be called" }),
    );
    const judgeClient = mockClient(
      JSON.stringify({ pass: true, reasoning: "judge client used" }),
    );

    const result = await judgeAssertion("output", ASSERTION, generationClient, judgeClient);

    expect(result.pass).toBe(true);
    expect(result.reasoning).toBe("judge client used");
    expect(judgeClient.generate).toHaveBeenCalledTimes(1);
    expect(generationClient.generate).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // TC-007: Backward compatibility — no judgeClient
  // ---------------------------------------------------------------------------

  it("uses generation client when judgeClient is not provided (TC-007)", async () => {
    const client = mockClient(
      JSON.stringify({ pass: true, reasoning: "generation client used" }),
    );

    const result = await judgeAssertion("output", ASSERTION, client);

    expect(result.pass).toBe(true);
    expect(client.generate).toHaveBeenCalledTimes(1);
  });

  it("handles judgeClient with mcpDeps", async () => {
    const generationClient = mockClient(
      JSON.stringify({ pass: false, reasoning: "should not be called" }),
    );
    const judgeClient = mockClient(
      JSON.stringify({ pass: true, reasoning: "judge + mcp" }),
    );

    const mcpDeps: McpDependency[] = [
      {
        server: "Slack",
        url: "https://mcp.slack.com/mcp",
        transport: "http",
        matchedTools: ["slack_send_message"],
        configSnippet: "{}",
      },
    ];

    const result = await judgeAssertion("output", ASSERTION, generationClient, judgeClient, mcpDeps);

    expect(result.pass).toBe(true);
    const systemPrompt = (judgeClient.generate as any).mock.calls[0][0];
    expect(systemPrompt).toContain("SIMULATION MODE");
    expect(generationClient.generate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// buildJudgeSystemPrompt
// ---------------------------------------------------------------------------

describe("buildJudgeSystemPrompt", () => {
  it("returns standard prompt when no MCP deps", () => {
    const prompt = buildJudgeSystemPrompt();
    expect(prompt).toContain("binary assertion evaluator");
    expect(prompt).not.toContain("SIMULATION MODE");
  });

  it("returns standard prompt when mcpDeps is empty", () => {
    const prompt = buildJudgeSystemPrompt([]);
    expect(prompt).toContain("binary assertion evaluator");
    expect(prompt).not.toContain("SIMULATION MODE");
  });

  it("returns augmented prompt with MCP deps", () => {
    const mcpDeps: McpDependency[] = [
      {
        server: "Slack",
        url: "https://mcp.slack.com/mcp",
        transport: "http",
        matchedTools: ["slack_send_message"],
        configSnippet: "{}",
      },
    ];

    const prompt = buildJudgeSystemPrompt(mcpDeps);
    expect(prompt).toContain("SIMULATION MODE");
    expect(prompt).toContain("Slack");
    expect(prompt).toContain("binary assertion evaluator");
  });

  it("lists all simulated servers", () => {
    const mcpDeps: McpDependency[] = [
      {
        server: "Slack",
        url: "https://mcp.slack.com/mcp",
        transport: "http",
        matchedTools: ["slack_send_message"],
        configSnippet: "{}",
      },
      {
        server: "GitHub",
        url: "https://api.githubcopilot.com/mcp/",
        transport: "http",
        matchedTools: ["github_create_pr"],
        configSnippet: "{}",
      },
    ];

    const prompt = buildJudgeSystemPrompt(mcpDeps);
    expect(prompt).toContain("Slack");
    expect(prompt).toContain("GitHub");
  });
});
