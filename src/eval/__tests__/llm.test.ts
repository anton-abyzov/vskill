import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCreate = vi.hoisted(() => vi.fn());
const mockSpawn = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
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
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  // -------------------------------------------------------------------------
  // Auto-detection
  // -------------------------------------------------------------------------

  it("defaults to claude-cli from a plain terminal", () => {
    const client = createLlmClient();
    expect(client.model).toBe("claude-sonnet");
  });

  it("auto-detects ollama inside Claude Code session", () => {
    process.env.CLAUDECODE = "1";
    const client = createLlmClient();
    expect(client.model).toBe("llama3.1:8b");
  });

  it("auto-detects anthropic when ANTHROPIC_API_KEY is set", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const client = createLlmClient();
    expect(client.model).toBe("claude-sonnet-4-20250514");
  });

  it("CLAUDECODE takes priority over ANTHROPIC_API_KEY for auto-detection", () => {
    process.env.CLAUDECODE = "1";
    process.env.ANTHROPIC_API_KEY = "test-key";
    const client = createLlmClient();
    expect(client.model).toBe("llama3.1:8b");
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
      });

      const client = createLlmClient();
      const result = await client.generate("system prompt", "user prompt");

      expect(result).toBe("Generated response");
      expect(mockCreate).toHaveBeenCalledOnce();
    });

    it("uses default model claude-sonnet-4-20250514", async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: "ok" }],
      });

      const client = createLlmClient();
      await client.generate("sys", "usr");

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: "claude-sonnet-4-20250514" }),
        expect.anything(),
      );
    });

    it("uses custom model from VSKILL_EVAL_MODEL", async () => {
      process.env.VSKILL_EVAL_MODEL = "claude-opus-4-20250514";
      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: "ok" }],
      });

      const client = createLlmClient();
      await client.generate("sys", "usr");

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: "claude-opus-4-20250514" }),
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

      expect(result).toBe("CLI response");
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
      expect(client.model).toBe("claude-sonnet");
    });

    it("passes custom model from VSKILL_EVAL_MODEL", async () => {
      process.env.VSKILL_EVAL_MODEL = "opus";
      mockSpawn.mockReturnValue(createFakeProc("ok\n"));

      const client = createLlmClient();
      expect(client.model).toBe("claude-opus");
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

      await expect(promise).rejects.toThrow("Claude CLI not found");
    });

    it("throws with truncated error on non-zero exit", async () => {
      mockSpawn.mockReturnValue(createFakeProc("", 1, "Something went wrong"));

      const client = createLlmClient();
      await expect(client.generate("sys", "usr")).rejects.toThrow(
        "Claude CLI exited with code 1: Something went wrong",
      );
    });

    it("throws when explicitly selected inside Claude Code session", () => {
      process.env.CLAUDECODE = "1";
      expect(() => createLlmClient()).toThrow(
        "Cannot use claude-cli provider inside a Claude Code session",
      );
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

      expect(result).toBe("Ollama reply");
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
