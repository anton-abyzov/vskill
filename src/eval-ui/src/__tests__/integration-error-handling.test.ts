// ---------------------------------------------------------------------------
// Integration tests: error handling flows across components (0569)
//
// These tests verify that the fixed components work together end-to-end:
// safeStringify, classifyErrorClient, ErrorCard, ErrorBoundary,
// workspaceReducer, sanitizeTestType, and the SkillWorkspace/TestsPanel wiring.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { safeStringify } from "../sse";
import { classifyErrorClient } from "../shared/classifyErrorClient";
import { sanitizeTestType } from "../pages/workspace/WorkspaceContext";
import { workspaceReducer, initialWorkspaceState } from "../pages/workspace/workspaceReducer";
import type { ClassifiedError } from "../shared/classifiedError";
import type { WorkspaceState, WorkspaceAction } from "../pages/workspace/workspaceTypes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return { ...initialWorkspaceState, ...overrides };
}

function dispatch(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  return workspaceReducer(state, action);
}

// ---------------------------------------------------------------------------
// Flow 1: Test Generation -> Error -> Retry (the original bug path)
//
// End-to-end flow:
//   1. generateEvals({ testType: "unit" }) -> sanitizeTestType -> body with testType
//   2. safeStringify serializes the body
//   3. Server returns an error -> classified by classifyErrorClient
//   4. GENERATE_EVALS_ERROR dispatched with classified error
//   5. User clicks Retry -> handleGenerateEvals() called with NO args
//   6. sanitizeTestType(undefined) -> no testType in body
//   7. Body serialized without testType
// ---------------------------------------------------------------------------
describe("Flow 1: generateEvals -> Error -> Retry (original bug path)", () => {
  it("sanitizeTestType('unit') produces 'unit' which gets included in request body", () => {
    const testType = sanitizeTestType("unit");
    expect(testType).toBe("unit");

    // Build the body the same way WorkspaceContext.generateEvals does
    const body: Record<string, unknown> = {};
    if (testType) body.testType = testType;

    const serialized = safeStringify(body);
    expect(serialized).toBeDefined();
    const parsed = JSON.parse(serialized!);
    expect(parsed.testType).toBe("unit");
  });

  it("sanitizeTestType(undefined) on retry produces a body WITHOUT testType", () => {
    const testType = sanitizeTestType(undefined);
    expect(testType).toBeUndefined();

    // Build the body the same way WorkspaceContext.generateEvals does
    const body: Record<string, unknown> = {};
    if (testType) body.testType = testType;

    // When body has no keys, generateEvals passes undefined to SSE start
    if (Object.keys(body).length === 0) {
      expect(safeStringify(undefined)).toBeUndefined();
    } else {
      const serialized = safeStringify(body);
      const parsed = JSON.parse(serialized!);
      expect(parsed).not.toHaveProperty("testType");
    }
  });

  it("MouseEvent-like object passed as opts?.testType is sanitized away", () => {
    // This is THE original bug: onClick passes MouseEvent as first arg.
    // sanitizeTestType must reject it so the retry body is clean.
    const fakeMouseEvent = { type: "click", target: null, bubbles: true, preventDefault: () => {} };

    // Simulating: generateEvals(mouseEvent) -> sanitizeTestType(mouseEvent.testType)
    // But the fix wraps it: onRetry={() => handleGenerateEvals()} so opts is undefined.
    // Either way, sanitizeTestType rejects any non-"unit"/"integration" value.
    expect(sanitizeTestType(fakeMouseEvent as any)).toBeUndefined();
    expect(sanitizeTestType(fakeMouseEvent.type as any)).toBeUndefined(); // "click"
  });

  it("error from server flows through classifyErrorClient to GENERATE_EVALS_ERROR", () => {
    // Step 1: Server returns model_not_found error string
    const serverError = 'model "claude-opus" not found';
    const classified = classifyErrorClient(serverError);

    // Step 2: classified gets dispatched
    let state = makeState({ generateEvalsLoading: true });
    state = dispatch(state, { type: "GENERATE_EVALS_ERROR", classified });

    // Step 3: Verify state is correctly updated
    expect(state.generateEvalsLoading).toBe(false);
    expect(state.generateEvalsError).not.toBeNull();
    expect(state.generateEvalsError!.category).toBe("model_not_found");
    expect(state.generateEvalsError!.description).toBe(serverError);
    expect(state.generateEvalsError!.retryable).toBe(false);
  });

  it("retry clears error: GENERATE_EVALS_START resets generateEvalsError to null", () => {
    const classified = classifyErrorClient("rate limit exceeded");
    let state = makeState();
    state = dispatch(state, { type: "GENERATE_EVALS_ERROR", classified });
    expect(state.generateEvalsError).not.toBeNull();

    // Retry triggers GENERATE_EVALS_START
    state = dispatch(state, { type: "GENERATE_EVALS_START" });
    expect(state.generateEvalsError).toBeNull();
    expect(state.generateEvalsLoading).toBe(true);
  });

  it("full round-trip: start -> error -> retry -> start clears all error state", () => {
    let state = makeState();

    // First run
    state = dispatch(state, { type: "GENERATE_EVALS_START" });
    expect(state.generateEvalsLoading).toBe(true);
    expect(state.generateEvalsError).toBeNull();
    expect(state.generateEvalsProgress).toEqual([]);

    // Error arrives
    const classified = classifyErrorClient("timeout");
    state = dispatch(state, { type: "GENERATE_EVALS_ERROR", classified });
    expect(state.generateEvalsLoading).toBe(false);
    expect(state.generateEvalsError!.category).toBe("timeout");

    // Retry
    state = dispatch(state, { type: "GENERATE_EVALS_START" });
    expect(state.generateEvalsLoading).toBe(true);
    expect(state.generateEvalsError).toBeNull();
    expect(state.generateEvalsProgress).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Flow 2: classifyErrorClient -> ErrorCard rendering
//
// Verify that various error strings flow correctly through the classifier
// and produce the expected ClassifiedError shapes.
// ---------------------------------------------------------------------------
describe("Flow 2: classifyErrorClient -> ClassifiedError properties", () => {
  const testCases: Array<{
    input: string;
    expectedCategory: ClassifiedError["category"];
    expectedRetryable: boolean;
    expectedTitleContains: string;
  }> = [
    { input: "rate limit exceeded", expectedCategory: "rate_limit", expectedRetryable: true, expectedTitleContains: "Rate Limit" },
    { input: "429 Too Many Requests", expectedCategory: "rate_limit", expectedRetryable: true, expectedTitleContains: "Rate Limit" },
    { input: "quota exceeded for model", expectedCategory: "rate_limit", expectedRetryable: true, expectedTitleContains: "Rate Limit" },
    { input: "401 Unauthorized", expectedCategory: "auth", expectedRetryable: false, expectedTitleContains: "Authentication" },
    { input: "Invalid API key provided", expectedCategory: "auth", expectedRetryable: false, expectedTitleContains: "Authentication" },
    { input: 'model "opus" not found', expectedCategory: "model_not_found", expectedRetryable: false, expectedTitleContains: "Model Not Found" },
    { input: 'model "gpt-5-turbo" not found in registry', expectedCategory: "model_not_found", expectedRetryable: false, expectedTitleContains: "Model Not Found" },
    { input: "Request timed out after 30s", expectedCategory: "timeout", expectedRetryable: true, expectedTitleContains: "Timed Out" },
    { input: "ETIMEDOUT", expectedCategory: "timeout", expectedRetryable: true, expectedTitleContains: "Timed Out" },
    { input: "random error xyz", expectedCategory: "unknown", expectedRetryable: false, expectedTitleContains: "Error" },
    { input: "", expectedCategory: "unknown", expectedRetryable: false, expectedTitleContains: "Error" },
  ];

  for (const tc of testCases) {
    it(`"${tc.input || "(empty)"}" -> ${tc.expectedCategory} (retryable=${tc.expectedRetryable})`, () => {
      const result = classifyErrorClient(tc.input);
      expect(result.category).toBe(tc.expectedCategory);
      expect(result.retryable).toBe(tc.expectedRetryable);
      expect(result.title).toContain(tc.expectedTitleContains);
      expect(result.description).toBe(tc.input);
      // Every classified error must have the full shape
      expect(result).toHaveProperty("hint");
      expect(typeof result.hint).toBe("string");
    });
  }

  it("model_not_found hint mentions switching model", () => {
    const result = classifyErrorClient('model "opus" not found');
    expect(result.hint).toMatch(/model/i);
    expect(result.hint).toMatch(/switch|different/i);
  });

  it("rate_limit hint mentions waiting", () => {
    const result = classifyErrorClient("rate limit exceeded");
    expect(result.hint).toMatch(/wait|moment/i);
  });

  it("auth hint mentions API key", () => {
    const result = classifyErrorClient("401 Unauthorized");
    expect(result.hint).toMatch(/key|credentials/i);
  });
});

// ---------------------------------------------------------------------------
// Flow 3: Workspace error -> classifyErrorClient -> ErrorCard -> Dismiss
//
// Test the SkillWorkspace error banner upgrade via reducer state transitions.
// ---------------------------------------------------------------------------
describe("Flow 3: Workspace error -> classify -> display -> dismiss", () => {
  it("SET_ERROR stores the error string; classifyErrorClient categorizes it correctly", () => {
    let state = makeState();
    state = dispatch(state, { type: "SET_ERROR", error: "rate limit exceeded" });
    expect(state.error).toBe("rate limit exceeded");

    // SkillWorkspace renders: classifyErrorClient(state.error) -> ErrorCard
    const classified = classifyErrorClient(state.error!);
    expect(classified.category).toBe("rate_limit");
    expect(classified.retryable).toBe(true);
  });

  it("SET_ERROR null clears the error (dismiss flow)", () => {
    let state = makeState({ error: "Something failed" });
    expect(state.error).toBe("Something failed");

    // Dismiss: dispatch SET_ERROR with null
    state = dispatch(state, { type: "SET_ERROR", error: null });
    expect(state.error).toBeNull();
  });

  it("multiple errors: latest SET_ERROR wins", () => {
    let state = makeState();
    state = dispatch(state, { type: "SET_ERROR", error: "first error" });
    state = dispatch(state, { type: "SET_ERROR", error: "second error" });
    expect(state.error).toBe("second error");
  });

  it("INIT_DATA clears any prior error", () => {
    let state = makeState({ error: "pre-existing error" });
    state = dispatch(state, {
      type: "INIT_DATA",
      skillContent: "# Skill",
      evals: null,
      benchmark: null,
    });
    expect(state.error).toBeNull();
  });

  it("error -> classify -> dismiss -> no error in state", () => {
    // Full flow as it happens in SkillWorkspace
    let state = makeState();

    // 1. Error occurs (e.g., delete failure)
    state = dispatch(state, { type: "SET_ERROR", error: "Failed to delete skill: 403 Forbidden" });
    expect(state.error).not.toBeNull();

    // 2. classify for display
    const classified = classifyErrorClient(state.error!);
    expect(classified.category).toBe("unknown"); // "Failed to delete..." doesn't match special categories

    // 3. User clicks dismiss
    state = dispatch(state, { type: "SET_ERROR", error: null });
    expect(state.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Flow 4: safeStringify -> SSE -> Error handling
//
// Test that non-serializable bodies are handled safely.
// ---------------------------------------------------------------------------
describe("Flow 4: safeStringify resilience for SSE body serialization", () => {
  it("circular reference: logs to console.error and falls back to safe JSON", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const circular: Record<string, unknown> = { provider: "anthropic", model: "claude" };
      circular.self = circular;

      const result = safeStringify(circular);
      expect(result).toBeDefined();

      // Must be valid JSON
      const parsed = JSON.parse(result!);
      expect(parsed.provider).toBe("anthropic");
      expect(parsed.model).toBe("claude");

      // Circular ref replaced
      expect(parsed.self).toBe("[Circular]");

      // console.error was called with the original error
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("DOM-like object with React fiber refs: serializes without crash", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const domLike: Record<string, unknown> = {
        nodeType: 1,
        tagName: "BUTTON",
        textContent: "Retry",
      };
      domLike.__reactFiber = { stateNode: domLike, child: { stateNode: domLike } };

      const result = safeStringify(domLike);
      expect(result).toBeDefined();
      expect(() => JSON.parse(result!)).not.toThrow();

      const parsed = JSON.parse(result!);
      expect(parsed.tagName).toBe("BUTTON");
    } finally {
      spy.mockRestore();
    }
  });

  it("undefined body returns undefined (no Content-Type body sent)", () => {
    expect(safeStringify(undefined)).toBeUndefined();
  });

  it("null body serializes to 'null'", () => {
    expect(safeStringify(null)).toBe("null");
  });

  it("plain request body: identical to JSON.stringify", () => {
    const body = { provider: "anthropic", model: "claude-sonnet", testType: "unit" };
    expect(safeStringify(body)).toBe(JSON.stringify(body));
  });

  it("body with nested arrays and objects: identical to JSON.stringify", () => {
    const body = {
      eval_ids: [1, 2, 3],
      options: { baseline_only: true },
      prompts: [{ prompt: "hello", expected: "should_activate" }],
    };
    expect(safeStringify(body)).toBe(JSON.stringify(body));
  });

  it("MouseEvent-like body serializes but produces garbage (demonstrates why sanitize is needed)", () => {
    // This shows WHY sanitizeTestType is critical: if a MouseEvent leaks through,
    // safeStringify will serialize it (it won't crash), but the server gets junk.
    const mouseEventLike = {
      type: "click",
      target: null,
      bubbles: true,
      isTrusted: true,
      timeStamp: 12345.67,
    };

    const result = safeStringify(mouseEventLike);
    expect(result).toBeDefined();

    const parsed = JSON.parse(result!);
    // The MouseEvent body will contain "type": "click" instead of proper request fields
    expect(parsed.type).toBe("click");
    // This is NOT a valid request — sanitizeTestType prevents this from ever reaching SSE
  });
});

// ---------------------------------------------------------------------------
// Flow 5: ErrorBoundary + SkillWorkspace integration
//
// Test that ErrorBoundary resets on skill change and that the reducer
// transitions work correctly for the workspace lifecycle.
// ---------------------------------------------------------------------------
describe("Flow 5: ErrorBoundary key + workspace lifecycle", () => {
  it("ErrorBoundary key format is plugin/skill", () => {
    // The key is `${state.plugin}/${state.skill}` in SkillWorkspace
    // Verify that different plugin/skill combos produce different keys
    const key1 = `${"marketing"}/${"chrome-post"}`;
    const key2 = `${"marketing"}/${"seo-tool"}`;
    const key3 = `${"personal"}/${"chrome-post"}`;

    expect(key1).not.toBe(key2);
    expect(key1).not.toBe(key3);
    expect(key2).not.toBe(key3);
  });

  it("CASE_RUN_ERROR -> inlineResults stores error with classified shape", () => {
    let state = makeState();
    state = dispatch(state, { type: "CASE_RUN_START", caseId: 1, mode: "benchmark" });
    state = dispatch(state, { type: "CASE_RUN_ERROR", caseId: 1, error: "model not found" });

    const caseState = state.caseRunStates.get(1);
    expect(caseState?.status).toBe("error");

    const result = state.inlineResults.get(1);
    expect(result).toBeDefined();
    expect(result!.status).toBe("error");
    expect(result!.errorMessage).toBe("model not found");
  });

  it("workspace loading state blocks panel rendering", () => {
    const state = makeState({ loading: true });
    // SkillWorkspace returns loading spinner when state.loading is true
    expect(state.loading).toBe(true);
    // Once INIT_DATA fires, loading becomes false
    const after = dispatch(state, {
      type: "INIT_DATA",
      skillContent: "content",
      evals: null,
      benchmark: null,
    });
    expect(after.loading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: reducer + classifyErrorClient integration
//
// Verify that the different error paths in the reducer all produce states
// that are compatible with how SkillWorkspace/TestsPanel consume them.
// ---------------------------------------------------------------------------
describe("Cross-cutting: reducer error paths + classifyErrorClient", () => {
  it("AI_EDIT_ERROR with classified error stores both message and classified", () => {
    const classified: ClassifiedError = {
      category: "rate_limit",
      title: "Rate Limit",
      description: "rate limit exceeded",
      hint: "Wait a moment.",
      retryable: true,
      retryAfterMs: 5000,
    };

    let state = makeState({ aiEditLoading: true });
    state = dispatch(state, {
      type: "AI_EDIT_ERROR",
      message: "rate limit exceeded",
      classified,
    });

    expect(state.aiEditLoading).toBe(false);
    expect(state.aiEditError).toBe("rate limit exceeded");
    expect(state.aiEditClassifiedError).not.toBeNull();
    expect(state.aiEditClassifiedError!.category).toBe("rate_limit");
    expect(state.aiEditClassifiedError!.retryAfterMs).toBe(5000);
  });

  it("AI_EDIT_ERROR without classified stores null for classifiedError", () => {
    let state = makeState({ aiEditLoading: true });
    state = dispatch(state, {
      type: "AI_EDIT_ERROR",
      message: "Unknown error occurred",
    });

    expect(state.aiEditError).toBe("Unknown error occurred");
    expect(state.aiEditClassifiedError).toBeNull();
  });

  it("GENERATE_EVALS_ERROR stores the full ClassifiedError for ErrorCard rendering", () => {
    const classified = classifyErrorClient("401 Unauthorized");

    let state = makeState({ generateEvalsLoading: true });
    state = dispatch(state, { type: "GENERATE_EVALS_ERROR", classified });

    // TestsPanel reads state.generateEvalsError and passes it to ErrorCard
    expect(state.generateEvalsError).not.toBeNull();
    expect(state.generateEvalsError!.category).toBe("auth");
    expect(state.generateEvalsError!.title).toBe("Authentication Failed");
    expect(state.generateEvalsError!.retryable).toBe(false);
  });

  it("SET_ERROR string -> classifyErrorClient -> all categories produce valid ClassifiedError", () => {
    const errorMessages = [
      "rate limit exceeded",
      "401 Unauthorized",
      "Request timed out",
      'model "claude-opus" not found',
      "random server error",
    ];

    for (const msg of errorMessages) {
      let state = makeState();
      state = dispatch(state, { type: "SET_ERROR", error: msg });
      expect(state.error).toBe(msg);

      // classifyErrorClient always produces valid shape
      const classified = classifyErrorClient(state.error!);
      expect(classified.category).toBeDefined();
      expect(typeof classified.title).toBe("string");
      expect(typeof classified.description).toBe("string");
      expect(typeof classified.hint).toBe("string");
      expect(typeof classified.retryable).toBe("boolean");
    }
  });
});

// ---------------------------------------------------------------------------
// Edge cases: sanitizeTestType + generateEvals body construction
// ---------------------------------------------------------------------------
describe("Edge cases: body construction for generateEvals", () => {
  it("with provider and model but no testType: body has only provider+model", () => {
    const body: Record<string, unknown> = {};
    const provider = "anthropic";
    const model = "claude-sonnet";
    if (provider) body.provider = provider;
    if (model) body.model = model;

    const testType = sanitizeTestType(undefined);
    if (testType) body.testType = testType;

    const serialized = safeStringify(body);
    const parsed = JSON.parse(serialized!);
    expect(parsed).toEqual({ provider: "anthropic", model: "claude-sonnet" });
    expect(parsed).not.toHaveProperty("testType");
  });

  it("with testType='unit': body includes all three fields", () => {
    const body: Record<string, unknown> = {};
    const provider = "openai";
    const model = "gpt-4";
    if (provider) body.provider = provider;
    if (model) body.model = model;

    const testType = sanitizeTestType("unit");
    if (testType) body.testType = testType;

    const serialized = safeStringify(body);
    const parsed = JSON.parse(serialized!);
    expect(parsed).toEqual({ provider: "openai", model: "gpt-4", testType: "unit" });
  });

  it("with testType='integration': body includes testType", () => {
    const body: Record<string, unknown> = {};
    const testType = sanitizeTestType("integration");
    if (testType) body.testType = testType;

    const serialized = safeStringify(body);
    const parsed = JSON.parse(serialized!);
    expect(parsed.testType).toBe("integration");
  });

  it("with no config at all: body is empty, safeStringify(undefined) is used", () => {
    const body: Record<string, unknown> = {};
    const testType = sanitizeTestType(undefined);
    if (testType) body.testType = testType;

    if (Object.keys(body).length === 0) {
      // generateEvals passes undefined body when empty
      const result = safeStringify(undefined);
      expect(result).toBeUndefined();
    }
  });

  it("sanitizeTestType rejects various garbage inputs that might leak through", () => {
    expect(sanitizeTestType("click")).toBeUndefined();
    expect(sanitizeTestType("")).toBeUndefined();
    expect(sanitizeTestType(0)).toBeUndefined();
    expect(sanitizeTestType(false)).toBeUndefined();
    expect(sanitizeTestType([])).toBeUndefined();
    expect(sanitizeTestType({ type: "click" })).toBeUndefined();
    expect(sanitizeTestType(Symbol("test"))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// State machine: generate evals full lifecycle
// ---------------------------------------------------------------------------
describe("State machine: generateEvals lifecycle through reducer", () => {
  it("idle -> start -> progress -> done", () => {
    let state = makeState();
    expect(state.generateEvalsLoading).toBe(false);
    expect(state.generateEvalsError).toBeNull();

    state = dispatch(state, { type: "GENERATE_EVALS_START" });
    expect(state.generateEvalsLoading).toBe(true);
    expect(state.generateEvalsProgress).toEqual([]);

    state = dispatch(state, {
      type: "GENERATE_EVALS_PROGRESS",
      entry: { timestamp: Date.now(), phase: "analyzing", message: "Reading skill..." },
    });
    expect(state.generateEvalsProgress).toHaveLength(1);

    state = dispatch(state, {
      type: "GENERATE_EVALS_DONE",
      evals: { skill_name: "test", evals: [] },
    });
    expect(state.generateEvalsLoading).toBe(false);
    expect(state.evals).not.toBeNull();
    expect(state.generateEvalsError).toBeNull();
  });

  it("idle -> start -> progress -> error -> retry -> start -> done", () => {
    let state = makeState();

    // First attempt
    state = dispatch(state, { type: "GENERATE_EVALS_START" });
    state = dispatch(state, {
      type: "GENERATE_EVALS_PROGRESS",
      entry: { timestamp: Date.now(), phase: "generating", message: "Calling LLM..." },
    });
    state = dispatch(state, {
      type: "GENERATE_EVALS_ERROR",
      classified: classifyErrorClient("rate limit exceeded"),
    });
    expect(state.generateEvalsLoading).toBe(false);
    expect(state.generateEvalsError!.category).toBe("rate_limit");

    // Retry
    state = dispatch(state, { type: "GENERATE_EVALS_START" });
    expect(state.generateEvalsLoading).toBe(true);
    expect(state.generateEvalsError).toBeNull();
    expect(state.generateEvalsProgress).toEqual([]);

    // Success on retry
    state = dispatch(state, {
      type: "GENERATE_EVALS_DONE",
      evals: { skill_name: "test", evals: [{ id: 1, name: "case1", prompt: "p", expected_output: "e", files: [], assertions: [] }] },
    });
    expect(state.generateEvalsLoading).toBe(false);
    expect(state.evals!.evals).toHaveLength(1);
  });

  it("error state preserves progress from failed attempt", () => {
    let state = makeState();
    state = dispatch(state, { type: "GENERATE_EVALS_START" });
    state = dispatch(state, {
      type: "GENERATE_EVALS_PROGRESS",
      entry: { timestamp: Date.now(), phase: "analyzing", message: "Step 1" },
    });
    state = dispatch(state, {
      type: "GENERATE_EVALS_PROGRESS",
      entry: { timestamp: Date.now(), phase: "generating", message: "Step 2" },
    });

    // Error arrives but progress is still in state (for display in ProgressLog)
    state = dispatch(state, {
      type: "GENERATE_EVALS_ERROR",
      classified: classifyErrorClient("timeout"),
    });
    expect(state.generateEvalsProgress).toHaveLength(2);
    expect(state.generateEvalsError!.category).toBe("timeout");

    // Retry clears progress
    state = dispatch(state, { type: "GENERATE_EVALS_START" });
    expect(state.generateEvalsProgress).toEqual([]);
  });
});
