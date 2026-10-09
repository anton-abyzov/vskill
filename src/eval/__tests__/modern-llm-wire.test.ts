// Real SDKs against a loopback fixture. This proves serialization and response
// handling, not a provider account's entitlement or model quality.
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createLlmClient } from "../llm.js";

let server: Server;
let requests: Array<{ path: string; body: Record<string, unknown> }>;
beforeEach(async () => {
  requests = [];
  server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ path: req.url!, body: JSON.parse(body) });
    res.writeHead(200, { "Content-Type": "application/json" });
    if (req.url!.includes("messages")) {
      res.end(JSON.stringify({
        id: "msg_fixture", type: "message", role: "assistant", model: "claude-opus-5-5",
        content: [{ type: "thinking", thinking: "", signature: "fixture" }, { type: "text", text: "fixture skill" }],
        stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 20 },
      }));
    } else {
      res.end(JSON.stringify({
        id: "fixture", object: "chat.completion", created: 1, model: "gpt-6.1-sol",
        choices: [{ index: 0, message: { role: "assistant", content: "fixture test" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  vi.stubEnv("ANTHROPIC_API_KEY", "loopback-only");
  vi.stubEnv("OPENAI_API_KEY", "loopback-only");
  vi.stubEnv("ANTHROPIC_BASE_URL", `http://127.0.0.1:${port}`);
  vi.stubEnv("OPENAI_BASE_URL", `http://127.0.0.1:${port}/v1`);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
});

it("serializes Opus 5.5 settings through the installed Anthropic SDK", async () => {
  const result = await createLlmClient({ provider: "anthropic", model: "claude-opus-5-5" }).generate("skill", "case");
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ path: "/v1/messages", body: {
    model: "claude-opus-5-5", max_tokens: 16_384, output_config: { effort: "medium" },
  } });
  expect(result.text).toBe("fixture skill");
  expect(result.cost).toBeCloseTo(0.00044);
});

it("serializes GPT-6.1 settings through the installed OpenAI SDK", async () => {
  const result = await createLlmClient({ provider: "openai", model: "gpt-6.1-sol" }).generate("skill", "case");
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ path: "/v1/chat/completions", body: {
    model: "gpt-6.1-sol", max_completion_tokens: 16_384, reasoning_effort: "medium",
  } });
  expect(requests[0].body).not.toHaveProperty("max_tokens");
  expect(result.text).toBe("fixture test");
  expect(result.cost).toBeCloseTo(0.00022);
});
