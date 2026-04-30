// 0815: skill-generator multiFile branch — fan-out + sequential body + warnings.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the LLM client. The same factory is called once per role; we hand back
// per-call canned responses by tracking invocation order.
const mockInvocations: Array<{ system: string; user: string; response: string }> = [];

vi.mock("../../eval/llm.js", () => {
  return {
    createLlmClient: () => ({
      generate: async (system: string, user: string) => {
        // Pull the next response queued by the test.
        const idx = mockInvocations.length;
        mockInvocations.push({ system, user, response: "" });
        return { text: queue[idx] };
      },
    }),
  };
});

// Mock detectProjectLayout — irrelevant to fan-out logic, but called by the
// generator to assemble pluginContext.
vi.mock("../../eval-server/skill-create-routes.js", async () => {
  const actual = await vi.importActual<typeof import("../../eval-server/skill-create-routes.js")>(
    "../../eval-server/skill-create-routes.js",
  );
  return {
    ...actual,
    detectProjectLayout: () => ({ detectedLayouts: [] }),
  };
});

let queue: string[] = [];

beforeEach(() => {
  mockInvocations.length = 0;
  queue = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

import { generateSkill } from "../skill-generator.js";

describe("generateSkill (multiFile=true)", () => {
  it("fans out 5 calls (script, grader, test, reference, eval) before body-agent runs", async () => {
    queue = [
      // script-agent
      JSON.stringify({
        files: [{ path: "scripts/audit.py", content: "print('hi')" }],
        runtime: { python: ">=3.10" },
      }),
      // grader-agent
      JSON.stringify({
        files: [{ path: "scripts/grader.py", content: "def grade(x): return 0.5" }],
      }),
      // test-agent
      JSON.stringify({
        files: [{ path: "tests/integration_test.py", content: "def test_x(): pass" }],
        secrets: ["STRIPE_API_KEY"],
        integrationTests: { runner: "pytest", file: "tests/integration_test.py", requires: ["STRIPE_API_KEY"] },
      }),
      // reference-agent
      JSON.stringify({
        files: [{ path: "references/refund-schema.md", content: "# refund schema" }],
      }),
      // eval-agent
      JSON.stringify({ evals: [{ id: 1, name: "x", prompt: "p", expected_output: "o", assertions: [] }] }),
      // body-agent (sequential, last)
      JSON.stringify({
        name: "stripe-refund-auditor",
        description: "audit stripe refunds",
        model: "",
        allowedTools: "Bash",
        body: "# /stripe-refund-auditor\n\nSee `scripts/audit.py`.",
      }) + "\n---REASONING---\nbecause",
    ];

    const result = await generateSkill(
      { prompt: "Stripe refund auditor", multiFile: true },
      { root: "/tmp/x" },
    );

    expect(mockInvocations).toHaveLength(6);
    // First 5 are fan-out (any order, but all happen before body-agent). Match
    // each agent on a distinctive substring anywhere in the system prompt.
    const fanoutSystems = mockInvocations.slice(0, 5).map((i) => i.system);
    expect(fanoutSystems.some((s) => s.includes("deterministic helper"))).toBe(true);
    expect(fanoutSystems.some((s) => s.includes("grader script"))).toBe(true);
    expect(fanoutSystems.some((s) => s.includes("integration test"))).toBe(true);
    expect(fanoutSystems.some((s) => s.includes("reference documentation"))).toBe(true);
    expect(fanoutSystems.some((s) => s.includes("AI skill evaluator"))).toBe(true);
    // Body-agent runs last and references produced files.
    expect(mockInvocations[5].user).toContain("scripts/audit.py");
    expect(mockInvocations[5].user).toContain("tests/integration_test.py");
    // Result aggregates everything.
    expect(result.files?.["scripts/audit.py"]).toBe("print('hi')");
    expect(result.files?.["scripts/grader.py"]).toContain("def grade");
    expect(result.files?.["tests/integration_test.py"]).toContain("def test_x");
    expect(result.files?.["references/refund-schema.md"]).toContain("# refund schema");
    expect(result.secrets).toEqual(["STRIPE_API_KEY"]);
    expect(result.integrationTests?.runner).toBe("pytest");
    expect(result.runtime?.python).toBe(">=3.10");
  });

  it("captures partial failures as multiFileWarnings rather than aborting", async () => {
    queue = [
      // script-agent FAILS (invalid JSON)
      "garbage not json",
      // grader-agent succeeds
      JSON.stringify({ files: [{ path: "scripts/grader.py", content: "x = 1" }] }),
      // test-agent FAILS (missing files)
      JSON.stringify({}),
      // reference-agent succeeds
      JSON.stringify({ files: [{ path: "references/a.md", content: "# a" }] }),
      // eval-agent succeeds
      JSON.stringify({ evals: [] }),
      // body-agent succeeds
      JSON.stringify({ name: "x", description: "y", model: "", allowedTools: "", body: "# /x" }),
    ];

    const result = await generateSkill(
      { prompt: "test", multiFile: true },
      { root: "/tmp/x" },
    );

    expect(result.multiFileWarnings).toBeDefined();
    expect(result.multiFileWarnings!.some((w) => w.startsWith("script-agent failed"))).toBe(true);
    expect(result.multiFileWarnings!.some((w) => w.startsWith("test-agent failed"))).toBe(true);
    // Surviving files made it through.
    expect(result.files?.["scripts/grader.py"]).toBe("x = 1");
    expect(result.files?.["references/a.md"]).toBe("# a");
    // Body still ran with whatever filenames survived.
    expect(result.body).toContain("# /x");
  });

  it("does NOT take the multiFile branch when flag is false (existing 2-call path)", async () => {
    queue = [
      // body-agent (existing path)
      JSON.stringify({ name: "x", description: "y", model: "", allowedTools: "", body: "# /x" }),
      // eval-agent
      JSON.stringify({ evals: [] }),
    ];

    const result = await generateSkill(
      { prompt: "test" },
      { root: "/tmp/x" },
    );

    // Only 2 LLM calls — the existing dual-LLM path.
    expect(mockInvocations).toHaveLength(2);
    expect(result.files).toBeUndefined();
    expect(result.multiFileWarnings).toBeUndefined();
  });
});
