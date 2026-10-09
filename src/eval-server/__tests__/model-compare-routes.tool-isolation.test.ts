import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Router } from "../router.js";
import { registerModelCompareRoutes } from "../model-compare-routes.js";
import { createLlmClient } from "../../eval/llm.js";
import { judgeAssertion } from "../../eval/judge.js";
import { studioTokenHeaders } from "./helpers/studio-token-test-helpers.js";

vi.mock("../../eval/llm.js", () => ({ createLlmClient: vi.fn() }));
vi.mock("../../eval/judge.js", () => ({ judgeAssertion: vi.fn() }));

describe("model comparison tool isolation", () => {
  let root: string;
  let server: Server;
  let url: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    root = mkdtempSync(join(tmpdir(), "vskill-compare-isolation-"));
    const skillDir = join(root, "plugins", "test-plugin", "skills", "test-skill");
    mkdirSync(join(skillDir, "evals"), { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# Test skill\nReply with a greeting.");
    writeFileSync(join(skillDir, "evals", "evals.json"), JSON.stringify({
      skill_name: "test-skill",
      evals: [{
        id: 1,
        name: "greeting",
        prompt: "Say hello",
        expected_output: "Hello",
        assertions: [{ id: "greeting", type: "boolean", text: "Contains a greeting" }],
      }],
    }));
    vi.mocked(createLlmClient).mockImplementation((options) => ({
      model: options!.model!,
      generate: vi.fn().mockResolvedValue({
        text: "Hello", durationMs: 1, inputTokens: 2, outputTokens: 1,
      }),
    }));
    vi.mocked(judgeAssertion).mockResolvedValue({
      id: "greeting", text: "Contains a greeting", pass: true, reasoning: "Greeting present",
    });
    const router = new Router();
    registerModelCompareRoutes(router, root);
    server = createServer((req, res) => { void router.handle(req, res); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    rmSync(root, { recursive: true, force: true });
  });

  it("strips forged internal overrides from both models before generation and judging", async () => {
    const response = await fetch(`${url}/api/skills/test-plugin/test-skill/compare-models`, {
      method: "POST",
      headers: { "content-type": "application/json", ...studioTokenHeaders() },
      body: JSON.stringify({
        eval_id: 1,
        modelA: { provider: "claude-cli", model: "claude-opus-5-5", allowTools: true },
        modelB: { provider: "claude-cli", model: "claude-sonnet-5-5", allowTools: true },
      }),
    });
    const events = await response.text();
    expect(response.status).toBe(200);
    expect(events).toContain("event: done");
    expect(events).not.toContain('"error":');
    expect(createLlmClient).toHaveBeenCalledTimes(2);
    expect(createLlmClient).toHaveBeenNthCalledWith(1, {
      provider: "claude-cli", model: "claude-opus-5-5",
    });
    expect(createLlmClient).toHaveBeenNthCalledWith(2, {
      provider: "claude-cli", model: "claude-sonnet-5-5",
    });
    const clients = vi.mocked(createLlmClient).mock.results.map((result) => result.value);
    expect(judgeAssertion).toHaveBeenCalledTimes(2);
    for (const [index, client] of clients.entries()) {
      expect(client.generate).toHaveBeenCalledOnce();
      expect(judgeAssertion).toHaveBeenNthCalledWith(index + 1, "Hello", expect.any(Object), client);
    }
  });
});
