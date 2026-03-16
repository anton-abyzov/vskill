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

const VALID_INTEGRATION_EVALS = {
  skill_name: "social-media-posting",
  evals: [
    {
      id: 1,
      name: "Post to Twitter",
      prompt: "Post 'Hello World' to Twitter",
      expected_output: "Tweet posted successfully",
      testType: "integration",
      requiredCredentials: ["TWITTER_BEARER_TOKEN"],
      requirements: { chromeProfile: "Default", platform: "Twitter" },
      cleanup: [
        {
          action: "delete_post",
          platform: "Twitter",
          identifier: "{POSTED_ID}",
          description: "Delete the posted tweet",
        },
      ],
      assertions: [
        { id: "assert-1", text: "Post appears on timeline", type: "boolean" },
        { id: "assert-2", text: "Post contains Hello World", type: "boolean" },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Integration-specific validation (T-015, T-019)
// ---------------------------------------------------------------------------

describe("loadAndValidateEvals — integration cases", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("accepts valid integration case with cleanup and requirements", () => {
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(VALID_INTEGRATION_EVALS));

    const result = loadAndValidateEvals("/skills/my-skill");
    expect(result.evals[0].testType).toBe("integration");
    expect(result.evals[0].cleanup).toHaveLength(1);
    expect(result.evals[0].cleanup[0].action).toBe("delete_post");
    expect(result.evals[0].requirements).toEqual({ chromeProfile: "Default", platform: "Twitter" });
  });

  it("passes through requiredCredentials on integration cases", () => {
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(VALID_INTEGRATION_EVALS));

    const result = loadAndValidateEvals("/skills/my-skill");
    expect(result.evals[0].requiredCredentials).toEqual(["TWITTER_BEARER_TOKEN"]);
  });

  // AC-US4-01: Missing requiredCredentials → warning (not error)
  it("emits warning (not error) for missing requiredCredentials", () => {
    const evalsNoCredentials = {
      ...VALID_INTEGRATION_EVALS,
      evals: [{
        ...VALID_INTEGRATION_EVALS.evals[0],
        requiredCredentials: undefined,
      }],
    };
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(evalsNoCredentials));

    // Should not throw — returns with warnings
    const result = loadAndValidateEvals("/skills/my-skill", { returnWarnings: true });
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w: any) => w.path.includes("requiredCredentials"))).toBe(true);
    expect(result.evalsFile.evals).toHaveLength(1);
  });

  // AC-US4-02: Invalid cleanup action → ValidationError
  it("throws for invalid cleanup action", () => {
    const evalsInvalidCleanup = {
      ...VALID_INTEGRATION_EVALS,
      evals: [{
        ...VALID_INTEGRATION_EVALS.evals[0],
        cleanup: [{ action: "invalid_action", platform: "Twitter" }],
      }],
    };
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(evalsInvalidCleanup));

    expect(() => loadAndValidateEvals("/skills/my-skill")).toThrow(EvalValidationError);
    try {
      loadAndValidateEvals("/skills/my-skill");
    } catch (e: any) {
      expect(e.errors[0].path).toContain("cleanup[0].action");
      expect(e.errors[0].message).toContain("invalid_action");
      expect(e.errors[0].message).toContain("delete_post");
      expect(e.errors[0].message).toContain("remove_artifact");
      expect(e.errors[0].message).toContain("custom");
    }
  });

  it("accepts all valid cleanup actions", () => {
    const validActions = ["delete_post", "remove_artifact", "custom"];
    for (const action of validActions) {
      const evals = {
        ...VALID_INTEGRATION_EVALS,
        evals: [{
          ...VALID_INTEGRATION_EVALS.evals[0],
          cleanup: [{ action, platform: "Twitter", identifier: "{ID}" }],
        }],
      };
      mocks.existsSync.mockReturnValue(true);
      mocks.readFileSync.mockReturnValue(JSON.stringify(evals));

      expect(() => loadAndValidateEvals("/skills/my-skill")).not.toThrow();
    }
  });

  // AC-US4-03: Prose assertions → warning suggesting API/existence assertions
  it("emits warning for LLM-judged prose assertions (long text, no outcome verb)", () => {
    const evalsProseAssertion = {
      ...VALID_INTEGRATION_EVALS,
      evals: [{
        ...VALID_INTEGRATION_EVALS.evals[0],
        assertions: [
          {
            id: "assert-1",
            text: "The system should properly handle the complex multi-step workflow that involves authentication tokens, session management, and cross-platform synchronization across all connected services in the pipeline",
            type: "boolean",
          },
        ],
      }],
    };
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(evalsProseAssertion));

    const result = loadAndValidateEvals("/skills/my-skill", { returnWarnings: true });
    expect(result.warnings.some((w: any) => w.message.includes("prose"))).toBe(true);
  });

  it("does not warn for short assertion text", () => {
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(VALID_INTEGRATION_EVALS));

    const result = loadAndValidateEvals("/skills/my-skill", { returnWarnings: true });
    const proseWarnings = result.warnings.filter((w: any) => w.message.includes("prose"));
    expect(proseWarnings).toHaveLength(0);
  });

  it("does not warn for long assertion with outcome verb", () => {
    const evalsOutcomeAssertion = {
      ...VALID_INTEGRATION_EVALS,
      evals: [{
        ...VALID_INTEGRATION_EVALS.evals[0],
        assertions: [
          {
            id: "assert-1",
            text: "The API response returns a 200 status code and the response body contains the expected data fields including the user profile information that was requested in the original query parameters",
            type: "boolean",
          },
        ],
      }],
    };
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(evalsOutcomeAssertion));

    const result = loadAndValidateEvals("/skills/my-skill", { returnWarnings: true });
    const proseWarnings = result.warnings.filter((w: any) => w.message.includes("prose"));
    expect(proseWarnings).toHaveLength(0);
  });

  // Mixed test types
  it("only validates integration-specific rules on integration cases", () => {
    const mixedEvals = {
      skill_name: "mixed-skill",
      evals: [
        {
          id: 1,
          name: "Unit test",
          prompt: "Test",
          expected_output: "output",
          testType: "unit",
          assertions: [{ id: "a1", text: "check", type: "boolean" }],
        },
        {
          id: 2,
          name: "Integration test",
          prompt: "Test",
          expected_output: "output",
          testType: "integration",
          requiredCredentials: ["TOKEN"],
          cleanup: [{ action: "delete_post", platform: "Twitter" }],
          assertions: [{ id: "a2", text: "check", type: "boolean" }],
        },
      ],
    };
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(mixedEvals));

    const result = loadAndValidateEvals("/skills/my-skill", { returnWarnings: true });
    expect(result.evalsFile.evals).toHaveLength(2);
    expect(result.evalsFile.evals[0].testType).toBe("unit");
    expect(result.evalsFile.evals[1].testType).toBe("integration");
    // No credential warnings for the integration case that has credentials
    const credWarnings = result.warnings.filter((w: any) => w.path.includes("requiredCredentials"));
    expect(credWarnings).toHaveLength(0);
  });

  // Backward compatibility — overload without returnWarnings
  it("returns EvalsFile directly when returnWarnings is not set", () => {
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(VALID_INTEGRATION_EVALS));

    const result = loadAndValidateEvals("/skills/my-skill");
    expect(result.skill_name).toBe("social-media-posting");
    expect(result.evals).toHaveLength(1);
    expect((result as any).warnings).toBeUndefined();
  });
});
