import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock readline for hidden input
vi.mock("node:readline", () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn((q: string, cb: (answer: string) => void) => cb("test-secret")),
    close: vi.fn(),
  })),
}));

// We test the underlying credential functions directly since CLI commands
// require stdin interaction
import { writeCredential, resolveCredential, resolveAllCredentials } from "../../../eval/credential-resolver.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cred-cli-test-"));
  // Create evals dir with a mock evals.json
  const evalsDir = join(tmpDir, "evals");
  mkdirSync(evalsDir, { recursive: true });
  writeFileSync(
    join(evalsDir, "evals.json"),
    JSON.stringify({
      skill_name: "test-skill",
      evals: [
        {
          id: 1,
          name: "unit-test",
          prompt: "test",
          expected_output: "out",
          assertions: [{ id: "a1", text: "passes", type: "boolean" }],
          testType: "unit",
        },
        {
          id: 2,
          name: "integration-test",
          prompt: "test",
          expected_output: "out",
          assertions: [{ id: "a2", text: "works", type: "boolean" }],
          testType: "integration",
          requiredCredentials: ["X_API_KEY", "LINKEDIN_TOKEN"],
        },
      ],
    }),
  );
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("credentials set (TC-064, TC-065)", () => {
  it("writes credential to .env.local", () => {
    writeCredential(tmpDir, "X_API_KEY", "secret123");
    const content = readFileSync(join(tmpDir, ".env.local"), "utf-8");
    expect(content).toContain("X_API_KEY=secret123");
  });

  it("adds .env.local to .gitignore", () => {
    writeFileSync(join(tmpDir, ".gitignore"), "node_modules/\n");
    writeCredential(tmpDir, "X_API_KEY", "val");
    const gitignore = readFileSync(join(tmpDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".env.local");
  });
});

describe("credentials list (TC-066)", () => {
  it("shows correct ready/missing statuses", () => {
    const original = process.env.X_API_KEY;
    process.env.X_API_KEY = "set-in-env";
    try {
      const statuses = resolveAllCredentials(["X_API_KEY", "LINKEDIN_TOKEN"], tmpDir);
      expect(statuses.find((s) => s.name === "X_API_KEY")?.status).toBe("ready");
      expect(statuses.find((s) => s.name === "LINKEDIN_TOKEN")?.status).toBe("missing");
    } finally {
      if (original === undefined) delete process.env.X_API_KEY;
      else process.env.X_API_KEY = original;
    }
  });
});

describe("credentials check (TC-067)", () => {
  it("shows source for dotenv credentials", () => {
    writeFileSync(join(tmpDir, ".env.local"), "LINKEDIN_TOKEN=from-dotenv\n");
    const result = resolveCredential("LINKEDIN_TOKEN", tmpDir);
    expect(result?.source).toBe("dotenv");
  });
});
