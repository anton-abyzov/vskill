import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: mocks.readFileSync,
  existsSync: mocks.existsSync,
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------

const { loadAndValidateEvals, EvalValidationError } = await import(
  "../schema.js"
);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_EVALS = {
  skill_name: "social-media-posting",
  evals: [
    {
      id: 1,
      name: "Basic post generation",
      prompt: "Create a social media post about AI",
      expected_output: "A well-crafted social media post",
      files: [],
      assertions: [
        { id: "assert-1", text: "Output mentions AI", type: "boolean" },
        { id: "assert-2", text: "Output is under 280 chars", type: "boolean" },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("loadAndValidateEvals", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("accepts valid evals.json and returns typed EvalsFile", () => {
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(VALID_EVALS));

    const result = loadAndValidateEvals("/skills/my-skill");

    expect(result.skill_name).toBe("social-media-posting");
    expect(result.evals).toHaveLength(1);
    expect(result.evals[0].assertions).toHaveLength(2);
  });

  it("throws for missing skill_name", () => {
    const invalid = { ...VALID_EVALS, skill_name: undefined };
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(invalid));

    expect(() => loadAndValidateEvals("/skills/my-skill")).toThrow(
      EvalValidationError,
    );
    try {
      loadAndValidateEvals("/skills/my-skill");
    } catch (e: any) {
      expect(e.errors.some((err: any) => err.path === "skill_name")).toBe(true);
    }
  });

  it("throws for missing evals array", () => {
    const invalid = { skill_name: "test" };
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(invalid));

    expect(() => loadAndValidateEvals("/skills/my-skill")).toThrow(
      EvalValidationError,
    );
    try {
      loadAndValidateEvals("/skills/my-skill");
    } catch (e: any) {
      expect(e.errors.some((err: any) => err.path === "evals")).toBe(true);
    }
  });

  it("throws for missing prompt in eval case", () => {
    const invalid = {
      skill_name: "test",
      evals: [
        {
          id: 1,
          name: "Test",
          expected_output: "output",
          assertions: [{ id: "a1", text: "ok", type: "boolean" }],
        },
      ],
    };
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(invalid));

    expect(() => loadAndValidateEvals("/skills/my-skill")).toThrow(
      EvalValidationError,
    );
    try {
      loadAndValidateEvals("/skills/my-skill");
    } catch (e: any) {
      expect(
        e.errors.some((err: any) => err.path === "evals[0].prompt"),
      ).toBe(true);
    }
  });

  it("throws for missing assertions", () => {
    const invalid = {
      skill_name: "test",
      evals: [
        {
          id: 1,
          name: "Test",
          prompt: "do something",
          expected_output: "output",
        },
      ],
    };
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(invalid));

    expect(() => loadAndValidateEvals("/skills/my-skill")).toThrow(
      EvalValidationError,
    );
    try {
      loadAndValidateEvals("/skills/my-skill");
    } catch (e: any) {
      expect(
        e.errors.some((err: any) => err.path === "evals[0].assertions"),
      ).toBe(true);
    }
  });

  it("throws for duplicate assertion IDs within a case", () => {
    const invalid = {
      skill_name: "test",
      evals: [
        {
          id: 1,
          name: "Test",
          prompt: "do something",
          expected_output: "output",
          assertions: [
            { id: "assert-1", text: "first", type: "boolean" },
            { id: "assert-1", text: "duplicate", type: "boolean" },
          ],
        },
      ],
    };
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(invalid));

    expect(() => loadAndValidateEvals("/skills/my-skill")).toThrow(
      EvalValidationError,
    );
    try {
      loadAndValidateEvals("/skills/my-skill");
    } catch (e: any) {
      expect(
        e.errors.some((err: any) => err.message.includes("assert-1")),
      ).toBe(true);
    }
  });

  it("throws for invalid JSON with file path info", () => {
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue("{ broken json");

    expect(() => loadAndValidateEvals("/skills/my-skill")).toThrow(
      EvalValidationError,
    );
    try {
      loadAndValidateEvals("/skills/my-skill");
    } catch (e: any) {
      expect(e.errors[0].path).toContain("evals.json");
      expect(e.errors[0].message).toMatch(/parse|JSON/i);
    }
  });

  it("throws for empty assertions array", () => {
    const invalid = {
      skill_name: "test",
      evals: [
        {
          id: 1,
          name: "Test",
          prompt: "do something",
          expected_output: "output",
          assertions: [],
        },
      ],
    };
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(invalid));

    expect(() => loadAndValidateEvals("/skills/my-skill")).toThrow(
      EvalValidationError,
    );
    try {
      loadAndValidateEvals("/skills/my-skill");
    } catch (e: any) {
      expect(
        e.errors.some((err: any) => err.message.includes("at least 1")),
      ).toBe(true);
    }
  });

  it("throws when evals.json does not exist", () => {
    mocks.existsSync.mockReturnValue(false);

    expect(() => loadAndValidateEvals("/skills/my-skill")).toThrow(
      EvalValidationError,
    );
    try {
      loadAndValidateEvals("/skills/my-skill");
    } catch (e: any) {
      expect(e.errors[0].message).toMatch(/not found|No evals\.json/i);
    }
  });

  it("accepts evals with optional files field defaulting to empty array", () => {
    const valid = {
      skill_name: "test",
      evals: [
        {
          id: 1,
          name: "Test",
          prompt: "do something",
          expected_output: "output",
          assertions: [{ id: "a1", text: "check", type: "boolean" }],
        },
      ],
    };
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(valid));

    const result = loadAndValidateEvals("/skills/my-skill");
    expect(result.evals[0].files).toEqual([]);
  });
});
