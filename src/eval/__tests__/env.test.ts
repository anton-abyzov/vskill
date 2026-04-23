import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetWarnOnce, resolveOllamaBaseUrl, warnOnce } from "../env.js";

describe("env — resolveOllamaBaseUrl", () => {
  beforeEach(() => {
    _resetWarnOnce();
  });

  it("returns OLLAMA_HOST when only OLLAMA_HOST is set", () => {
    const logger = vi.fn();
    expect(
      resolveOllamaBaseUrl({ OLLAMA_HOST: "http://gpu:11434" }, logger),
    ).toBe("http://gpu:11434");
    expect(logger).not.toHaveBeenCalled();
  });

  it("returns OLLAMA_BASE_URL when only OLLAMA_BASE_URL is set (backcompat)", () => {
    const logger = vi.fn();
    expect(
      resolveOllamaBaseUrl({ OLLAMA_BASE_URL: "http://legacy:11434" }, logger),
    ).toBe("http://legacy:11434");
    expect(logger).not.toHaveBeenCalled();
  });

  it("prefers OLLAMA_HOST when both env vars differ and warns once across many calls", () => {
    const logger = vi.fn();
    const env = { OLLAMA_HOST: "http://gpu:11434", OLLAMA_BASE_URL: "http://legacy:11434" };
    for (let i = 0; i < 10; i++) {
      expect(resolveOllamaBaseUrl(env, logger)).toBe("http://gpu:11434");
    }
    expect(logger).toHaveBeenCalledTimes(1);
    const message = logger.mock.calls[0]?.[0] as string;
    expect(message).toContain("OLLAMA_HOST");
    expect(message).toContain("OLLAMA_BASE_URL");
    expect(message).toContain("deprecated");
  });

  it("does not warn when both env vars are set to the same value", () => {
    const logger = vi.fn();
    resolveOllamaBaseUrl(
      { OLLAMA_HOST: "http://gpu:11434", OLLAMA_BASE_URL: "http://gpu:11434" },
      logger,
    );
    expect(logger).not.toHaveBeenCalled();
  });

  it("prepends http:// to bare host:port values", () => {
    expect(resolveOllamaBaseUrl({ OLLAMA_HOST: "gpu.local:11434" })).toBe(
      "http://gpu.local:11434",
    );
  });

  it("preserves the https:// scheme intact", () => {
    expect(resolveOllamaBaseUrl({ OLLAMA_HOST: "https://secure.gpu:443" })).toBe(
      "https://secure.gpu:443",
    );
  });

  it("returns the default localhost URL when neither is set", () => {
    expect(resolveOllamaBaseUrl({})).toBe("http://localhost:11434");
  });
});

describe("env — warnOnce", () => {
  beforeEach(() => {
    _resetWarnOnce();
  });

  it("emits a message exactly once per process", () => {
    const logger = vi.fn();
    warnOnce("msg-a", logger);
    warnOnce("msg-a", logger);
    warnOnce("msg-a", logger);
    expect(logger).toHaveBeenCalledTimes(1);
  });

  it("distinguishes distinct messages", () => {
    const logger = vi.fn();
    warnOnce("msg-a", logger);
    warnOnce("msg-b", logger);
    expect(logger).toHaveBeenCalledTimes(2);
  });

  it("falls back to console.warn when no logger is provided", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      warnOnce("console-fallback");
      expect(spy).toHaveBeenCalledWith("console-fallback");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("env — no inline OLLAMA_BASE_URL reads outside env.ts", () => {
  it("grep asserts helper centralisation", async () => {
    const { execSync } = await import("node:child_process");
    const path = await import("node:path");
    const fileURLToPath = (url: string) => new URL(url).pathname;
    const here = fileURLToPath(new URL(".", import.meta.url));
    const repoRoot = path.resolve(here, "..", "..", "..");
    const cmd = `grep -rn "process\\.env\\.OLLAMA_BASE_URL" ${path.join(
      repoRoot,
      "src",
    )} --include='*.ts' --exclude-dir=__tests__ || true`;
    const result = execSync(cmd, { encoding: "utf8" });
    const lines = result
      .split("\n")
      .filter(Boolean)
      .filter((l) => !l.includes(`${path.sep}eval${path.sep}env.ts`));
    expect(lines).toEqual([]);
  });
});

afterEach(() => {
  _resetWarnOnce();
});
