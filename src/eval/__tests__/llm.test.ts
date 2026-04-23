import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCreate = vi.hoisted(() => vi.fn());
const mockSpawn = vi.hoisted(() => vi.fn());
const mockResolveCliBinary = vi.hoisted(() => vi.fn((name: string) => name));
const mockEnhancedPath = vi.hoisted(() => vi.fn((p?: string) => p || process.env.PATH || ""));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
}));

vi.mock("../../utils/resolve-binary.js", () => ({
  resolveCliBinary: mockResolveCliBinary,
  enhancedPath: mockEnhancedPath,
}));

// ---------------------------------------------------------------------------
// Spawn helper — creates a fake ChildProcess for testing
// ---------------------------------------------------------------------------
import { EventEmitter } from "node:events";

function createFakeProc(stdoutData: string, exitCode = 0, stderrData = "") {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { end: vi.fn(), write: vi.fn() };
  proc.kill = vi.fn();

  // Emit stdout/stderr and close on next tick
  setTimeout(() => {
    if (stdoutData) proc.stdout.emit("data", Buffer.from(stdoutData));
    if (stderrData) proc.stderr.emit("data", Buffer.from(stderrData));
    proc.emit("close", exitCode);
  }, 0);

  return proc;
}

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------

const { createLlmClient } = await import("../llm.js");
import type { ProviderName } from "../llm.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createLlmClient", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.VSKILL_EVAL_PROVIDER;
    delete process.env.VSKILL_EVAL_MODEL;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.CLAUDECODE;
    delete process.env.CODEX_API_KEY;
    delete process.env.GOOGLE_API_KEY;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  // -------------------------------------------------------------------------
  // Auto-detection
  // -------------------------------------------------------------------------

  it("defaults to claude-cli from a plain terminal", () => {
    const client = createLlmClient();
    expect(client.model).toBe("sonnet");
  });

  it("defaults to claude-cli even inside Claude Code session", () => {
    process.env.CLAUDECODE = "1";
    const client = createLlmClient();
    expect(client.model).toBe("sonnet");
  });

  it("explicit VSKILL_EVAL_PROVIDER overrides auto-detection", () => {
    process.env.VSKILL_EVAL_PROVIDER = "ollama";
    process.env.ANTHROPIC_API_KEY = "test-key";
    const client = createLlmClient();
    expect(client.model).toBe("llama3.1:8b");
  });

  it("throws on unknown provider", () => {
    process.env.VSKILL_EVAL_PROVIDER = "gpt-magic";
    expect(() => createLlmClient()).toThrow('Unknown VSKILL_EVAL_PROVIDER: "gpt-magic"');
  });

  it("selects codex-cli provider from env", () => {
    process.env.VSKILL_EVAL_PROVIDER = "codex-cli";
    const client = createLlmClient();
    expect(client.model).toBe("codex-o4-mini");
  });

  it("selects gemini-cli provider from env", () => {
    process.env.VSKILL_EVAL_PROVIDER = "gemini-cli";
    const client = createLlmClient();
    expect(client.model).toBe("gemini-2.5-pro");
  });

  // -------------------------------------------------------------------------
  // Override params
  // -------------------------------------------------------------------------

  it("override provider takes precedence over env var", () => {
    process.env.VSKILL_EVAL_PROVIDER = "ollama";
    process.env.ANTHROPIC_API_KEY = "test-key";
    const client = createLlmClient({ provider: "anthropic" });
    expect(client.model).toBe("claude-sonnet-4-6");
  });

  it("override model takes precedence over env var", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const client = createLlmClient({ provider: "anthropic", model: "claude-opus-4-6" });
    expect(client.model).toBe("claude-opus-4-6");
  });

  it("override provider=claude-cli with custom model", () => {
    const client = createLlmClient({ provider: "claude-cli", model: "opus" });
    expect(client.model).toBe("opus");
  });

  it("override provider=ollama with custom model", () => {
    const client = createLlmClient({ provider: "ollama", model: "qwen2.5:32b" });
    expect(client.model).toBe("qwen2.5:32b");
  });

  it("override provider=claude-cli inside Claude Code session", () => {
    process.env.CLAUDECODE = "1";
    const client = createLlmClient({ provider: "claude-cli" });
    expect(client.model).toBe("sonnet");
  });

  it("override provider=codex-cli with custom model", () => {
    const client = createLlmClient({ provider: "codex-cli", model: "codex-1" });
    expect(client.model).toBe("codex-codex-1");
  });

  it("override provider=gemini-cli with custom model", () => {
    const client = createLlmClient({ provider: "gemini-cli", model: "gemini-2.5-flash" });
    expect(client.model).toBe("gemini-2.5-flash");
  });

  // -------------------------------------------------------------------------
  // Anthropic provider
  // -------------------------------------------------------------------------

  describe("anthropic provider", () => {
    beforeEach(() => {
      process.env.VSKILL_EVAL_PROVIDER = "anthropic";
      process.env.ANTHROPIC_API_KEY = "test-key";
    });

    it("returns text content on successful generate call", async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: "Generated response" }],
        usage: { input_tokens: 50, output_tokens: 100 },
      });

      const client = createLlmClient();
      const result = await client.generate("system prompt", "user prompt");

      expect(result.text).toBe("Generated response");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.inputTokens).toBe(50);
      expect(result.outputTokens).toBe(100);
      expect(mockCreate).toHaveBeenCalledOnce();
    });

    it("uses default model claude-sonnet-4-6", async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: "ok" }],
      });

      const client = createLlmClient();
      await client.generate("sys", "usr");

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: "claude-sonnet-4-6" }),
        expect.anything(),
      );
    });

    it("uses custom model from VSKILL_EVAL_MODEL", async () => {
      process.env.VSKILL_EVAL_MODEL = "claude-opus-4-6";
      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: "ok" }],
      });

      const client = createLlmClient();
      await client.generate("sys", "usr");

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: "claude-opus-4-6" }),
        expect.anything(),
      );
    });

    it("propagates network error from SDK", async () => {
      mockCreate.mockRejectedValue(new Error("Connection timeout"));

      const client = createLlmClient();
      await expect(client.generate("sys", "usr")).rejects.toThrow(
        "Connection timeout",
      );
    });

    it("passes system and user prompts correctly", async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: "ok" }],
      });

      const client = createLlmClient();
      await client.generate("my system prompt", "my user prompt");

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: "my system prompt",
          messages: [{ role: "user", content: "my user prompt" }],
          max_tokens: 4096,
        }),
        expect.anything(),
      );
    });

    it("throws when ANTHROPIC_API_KEY is not set", () => {
      delete process.env.ANTHROPIC_API_KEY;
      expect(() => createLlmClient()).toThrow("ANTHROPIC_API_KEY is not set");
    });
  });

  // -------------------------------------------------------------------------
  // Claude CLI provider
  // -------------------------------------------------------------------------

  describe("claude-cli provider", () => {
    beforeEach(() => {
      process.env.VSKILL_EVAL_PROVIDER = "claude-cli";
    });

    it("spawns claude CLI with -p and --model, pipes prompt via stdin", async () => {
      mockSpawn.mockReturnValue(createFakeProc("CLI response\n"));

      const client = createLlmClient();
      const result = await client.generate("system prompt", "user prompt");

      expect(result.text).toBe("CLI response");
      expect(mockSpawn).toHaveBeenCalledWith(
        "claude",
        ["-p", "--model", "sonnet"],
        expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
      );
      // Verify prompt was piped via stdin
      const proc = mockSpawn.mock.results[0].value;
      expect(proc.stdin.end).toHaveBeenCalledWith("system prompt\n\nuser prompt");
    });

    it("defaults to sonnet model", () => {
      const client = createLlmClient();
      expect(client.model).toBe("sonnet");
    });

    it("passes custom model from VSKILL_EVAL_MODEL", async () => {
      process.env.VSKILL_EVAL_MODEL = "opus";
      mockSpawn.mockReturnValue(createFakeProc("ok\n"));

      const client = createLlmClient();
      expect(client.model).toBe("opus");
      await client.generate("sys", "usr");

      expect(mockSpawn).toHaveBeenCalledWith(
        "claude",
        ["-p", "--model", "opus"],
        expect.anything(),
      );
    });

    it("throws helpful error when claude CLI not found", async () => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdin = { end: vi.fn(), write: vi.fn() };
      proc.kill = vi.fn();
      mockSpawn.mockReturnValue(proc);

      const client = createLlmClient();
      const promise = client.generate("sys", "usr");

      // Emit ENOENT error
      setTimeout(() => {
        const err = new Error("spawn claude ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        proc.emit("error", err);
      }, 0);

      await expect(promise).rejects.toThrow("Claude Code not found");
    });

    it("throws with truncated error on non-zero exit", async () => {
      mockSpawn.mockReturnValue(createFakeProc("", 1, "Something went wrong"));

      const client = createLlmClient();
      await expect(client.generate("sys", "usr")).rejects.toThrow(
        "Claude CLI exited with code 1: Something went wrong",
      );
    });

    it("works inside Claude Code session (strips CLAUDE* env vars)", async () => {
      process.env.CLAUDECODE = "1";
      mockSpawn.mockReturnValue(createFakeProc("response\n"));

      const client = createLlmClient();
      expect(client.model).toBe("sonnet");
      await client.generate("sys", "usr");

      // Verify CLAUDE* env vars are stripped from spawned process
      const spawnCall = mockSpawn.mock.calls[0];
      const env = spawnCall[2].env;
      expect(env.CLAUDECODE).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Codex CLI provider
  // -------------------------------------------------------------------------

  describe("codex-cli provider", () => {
    beforeEach(() => {
      process.env.VSKILL_EVAL_PROVIDER = "codex-cli";
    });

    it("spawns codex CLI with exec and --model, pipes prompt via stdin", async () => {
      mockSpawn.mockReturnValue(createFakeProc("Codex response\n"));

      const client = createLlmClient();
      const result = await client.generate("system prompt", "user prompt");

      expect(result.text).toBe("Codex response");
      expect(mockSpawn).toHaveBeenCalledWith(
        "codex",
        ["exec", "--model", "o4-mini"],
        expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
      );
      // Verify prompt was piped via stdin
      const proc = mockSpawn.mock.results[0].value;
      expect(proc.stdin.end).toHaveBeenCalledWith("system prompt\n\nuser prompt");
    });

    it("defaults to o4-mini model", () => {
      const client = createLlmClient();
      expect(client.model).toBe("codex-o4-mini");
    });

    it("passes custom model from VSKILL_EVAL_MODEL", async () => {
      process.env.VSKILL_EVAL_MODEL = "codex-1";
      mockSpawn.mockReturnValue(createFakeProc("ok\n"));

      const client = createLlmClient();
      expect(client.model).toBe("codex-codex-1");
      await client.generate("sys", "usr");

      expect(mockSpawn).toHaveBeenCalledWith(
        "codex",
        ["exec", "--model", "codex-1"],
        expect.anything(),
      );
    });

    it("passes gpt-5.3-codex model", async () => {
      process.env.VSKILL_EVAL_MODEL = "gpt-5.3-codex";
      mockSpawn.mockReturnValue(createFakeProc("ok\n"));

      const client = createLlmClient();
      expect(client.model).toBe("codex-gpt-5.3-codex");
      await client.generate("sys", "usr");

      expect(mockSpawn).toHaveBeenCalledWith(
        "codex",
        ["exec", "--model", "gpt-5.3-codex"],
        expect.anything(),
      );
    });

    it("throws helpful error when codex CLI not found", async () => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdin = { end: vi.fn(), write: vi.fn() };
      proc.kill = vi.fn();
      mockSpawn.mockReturnValue(proc);

      const client = createLlmClient();
      const promise = client.generate("sys", "usr");

      // Emit ENOENT error
      setTimeout(() => {
        const err = new Error("spawn codex ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        proc.emit("error", err);
      }, 0);

      await expect(promise).rejects.toThrow("Codex CLI not found");
    });

    it("error message suggests install command and fallback provider", async () => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdin = { end: vi.fn(), write: vi.fn() };
      proc.kill = vi.fn();
      mockSpawn.mockReturnValue(proc);

      const client = createLlmClient();
      const promise = client.generate("sys", "usr");

      setTimeout(() => {
        const err = new Error("spawn codex ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        proc.emit("error", err);
      }, 0);

      await expect(promise).rejects.toThrow("npm install -g @openai/codex");
      // Also suggests claude-cli as fallback
    });

    it("throws with truncated error on non-zero exit", async () => {
      mockSpawn.mockReturnValue(createFakeProc("", 1, "Authentication failed"));

      const client = createLlmClient();
      await expect(client.generate("sys", "usr")).rejects.toThrow(
        "Codex CLI exited with code 1: Authentication failed",
      );
    });

    it("returns null for token counts (CLI does not report them)", async () => {
      mockSpawn.mockReturnValue(createFakeProc("response\n"));

      const client = createLlmClient();
      const result = await client.generate("sys", "usr");

      expect(result.inputTokens).toBeNull();
      expect(result.outputTokens).toBeNull();
    });

    it("measures duration", async () => {
      mockSpawn.mockReturnValue(createFakeProc("response\n"));

      const client = createLlmClient();
      const result = await client.generate("sys", "usr");

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("does not strip env vars (no nesting detection like Claude)", async () => {
      process.env.CLAUDECODE = "1";
      mockSpawn.mockReturnValue(createFakeProc("response\n"));

      const client = createLlmClient();
      await client.generate("sys", "usr");

      // Codex CLI doesn't strip CLAUDE* env vars — they should be preserved
      const spawnCall = mockSpawn.mock.calls[0];
      const env = spawnCall[2].env;
      expect(env).toBeDefined();
      expect(env.CLAUDECODE).toBe("1"); // preserved, unlike claude-cli provider
    });
  });

  // -------------------------------------------------------------------------
  // Gemini CLI provider
  // -------------------------------------------------------------------------

  describe("gemini-cli provider", () => {
    beforeEach(() => {
      process.env.VSKILL_EVAL_PROVIDER = "gemini-cli";
    });

    it("spawns gemini CLI with -p and --model, pipes prompt via stdin", async () => {
      mockSpawn.mockReturnValue(createFakeProc("Gemini response\n"));

      const client = createLlmClient();
      const result = await client.generate("system prompt", "user prompt");

      expect(result.text).toBe("Gemini response");
      expect(mockSpawn).toHaveBeenCalledWith(
        "gemini",
        ["-p", "--model", "gemini-2.5-pro"],
        expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
      );
      // Verify prompt was piped via stdin
      const proc = mockSpawn.mock.results[0].value;
      expect(proc.stdin.end).toHaveBeenCalledWith("system prompt\n\nuser prompt");
    });

    it("defaults to gemini-2.5-pro model", () => {
      const client = createLlmClient();
      expect(client.model).toBe("gemini-2.5-pro");
    });

    it("passes custom model from VSKILL_EVAL_MODEL", async () => {
      process.env.VSKILL_EVAL_MODEL = "gemini-2.5-flash";
      mockSpawn.mockReturnValue(createFakeProc("ok\n"));

      const client = createLlmClient();
      expect(client.model).toBe("gemini-2.5-flash");
      await client.generate("sys", "usr");

      expect(mockSpawn).toHaveBeenCalledWith(
        "gemini",
        ["-p", "--model", "gemini-2.5-flash"],
        expect.anything(),
      );
    });

    it("uses model name directly without prefix (already has gemini- prefix)", () => {
      const client = createLlmClient();
      // Unlike claude-cli (claude-{model}) or codex-cli (codex-{model}),
      // gemini models already have the gemini- prefix in their names
      expect(client.model).toBe("gemini-2.5-pro");
    });

    it("throws helpful error when gemini CLI not found", async () => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdin = { end: vi.fn(), write: vi.fn() };
      proc.kill = vi.fn();
      mockSpawn.mockReturnValue(proc);

      const client = createLlmClient();
      const promise = client.generate("sys", "usr");

      // Emit ENOENT error
      setTimeout(() => {
        const err = new Error("spawn gemini ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        proc.emit("error", err);
      }, 0);

      await expect(promise).rejects.toThrow("Gemini CLI not found");
    });

    it("error message suggests install via npm", async () => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdin = { end: vi.fn(), write: vi.fn() };
      proc.kill = vi.fn();
      mockSpawn.mockReturnValue(proc);

      const client = createLlmClient();
      const promise = client.generate("sys", "usr");

      setTimeout(() => {
        const err = new Error("spawn gemini ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        proc.emit("error", err);
      }, 0);

      await expect(promise).rejects.toThrow("npm install -g @google/gemini-cli");
    });

    it("throws with truncated error on non-zero exit", async () => {
      mockSpawn.mockReturnValue(createFakeProc("", 1, "Rate limit exceeded"));

      const client = createLlmClient();
      await expect(client.generate("sys", "usr")).rejects.toThrow(
        "Gemini CLI exited with code 1: Rate limit exceeded",
      );
    });

    it("returns null for token counts (CLI does not report them)", async () => {
      mockSpawn.mockReturnValue(createFakeProc("response\n"));

      const client = createLlmClient();
      const result = await client.generate("sys", "usr");

      expect(result.inputTokens).toBeNull();
      expect(result.outputTokens).toBeNull();
    });

    it("measures duration", async () => {
      mockSpawn.mockReturnValue(createFakeProc("response\n"));

      const client = createLlmClient();
      const result = await client.generate("sys", "usr");

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("does not strip env vars", async () => {
      process.env.GOOGLE_API_KEY = "test-key";
      mockSpawn.mockReturnValue(createFakeProc("response\n"));

      const client = createLlmClient();
      await client.generate("sys", "usr");

      // Gemini CLI doesn't strip any env vars — all should be preserved
      const spawnCall = mockSpawn.mock.calls[0];
      const env = spawnCall[2].env;
      expect(env).toBeDefined();
      expect(env.GOOGLE_API_KEY).toBe("test-key"); // preserved
    });
  });

  // -------------------------------------------------------------------------
  // Cross-provider consistency
  // -------------------------------------------------------------------------

  describe("cross-provider consistency", () => {
    it("all CLI providers use stdin piping for prompts", async () => {
      const providers = [
        { provider: "claude-cli" as const, binary: "claude" },
        { provider: "codex-cli" as const, binary: "codex" },
        { provider: "gemini-cli" as const, binary: "gemini" },
      ];

      for (const { provider, binary } of providers) {
        mockSpawn.mockReturnValue(createFakeProc("ok\n"));
        process.env.VSKILL_EVAL_PROVIDER = provider;

        const client = createLlmClient();
        await client.generate("sys", "usr");

        const proc = mockSpawn.mock.results[mockSpawn.mock.results.length - 1].value;
        expect(proc.stdin.end).toHaveBeenCalledWith("sys\n\nusr");
        vi.resetAllMocks();
      }
    });

    it("all CLI providers use pipe stdio", async () => {
      const providers: Array<{ provider: ProviderName }> = [
        { provider: "claude-cli" },
        { provider: "codex-cli" },
        { provider: "gemini-cli" },
      ];

      for (const { provider } of providers) {
        mockSpawn.mockReturnValue(createFakeProc("ok\n"));
        process.env.VSKILL_EVAL_PROVIDER = provider;

        const client = createLlmClient();
        await client.generate("sys", "usr");

        const spawnCall = mockSpawn.mock.calls[mockSpawn.mock.calls.length - 1];
        expect(spawnCall[2].stdio).toEqual(["pipe", "pipe", "pipe"]);
        vi.resetAllMocks();
      }
    });

    it("all providers implement the LlmClient interface", () => {
      const configs: Array<{ provider: ProviderName; setup: () => void }> = [
        { provider: "claude-cli", setup: () => {} },
        { provider: "codex-cli", setup: () => {} },
        { provider: "gemini-cli", setup: () => {} },
        { provider: "anthropic", setup: () => { process.env.ANTHROPIC_API_KEY = "test"; } },
        { provider: "ollama", setup: () => {} },
      ];

      for (const { provider, setup } of configs) {
        setup();
        const client = createLlmClient({ provider });
        expect(client).toHaveProperty("model");
        expect(client).toHaveProperty("generate");
        expect(typeof client.generate).toBe("function");
        expect(typeof client.model).toBe("string");
      }
    });
  });

  // -------------------------------------------------------------------------
  // Ollama provider
  // -------------------------------------------------------------------------

  describe("ollama provider", () => {
    beforeEach(() => {
      process.env.VSKILL_EVAL_PROVIDER = "ollama";
    });

    it("uses default model llama3.1:8b", () => {
      const client = createLlmClient();
      expect(client.model).toBe("llama3.1:8b");
    });

    it("uses custom model from VSKILL_EVAL_MODEL", () => {
      process.env.VSKILL_EVAL_MODEL = "qwen2.5:32b";
      const client = createLlmClient();
      expect(client.model).toBe("qwen2.5:32b");
    });

    it("calls Ollama HTTP API with correct payload", async () => {
      const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ response: "Ollama reply" }), { status: 200 }),
      );

      const client = createLlmClient();
      const result = await client.generate("system prompt", "user prompt");

      expect(result.text).toBe("Ollama reply");
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/generate",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"model":"llama3.1:8b"'),
        }),
      );

      mockFetch.mockRestore();
    });

    it("uses custom base URL from OLLAMA_BASE_URL", async () => {
      process.env.OLLAMA_BASE_URL = "http://gpu-server:11434";

      const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ response: "ok" }), { status: 200 }),
      );

      const client = createLlmClient();
      await client.generate("sys", "usr");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://gpu-server:11434/api/generate",
        expect.anything(),
      );

      mockFetch.mockRestore();
    });
  });
});
