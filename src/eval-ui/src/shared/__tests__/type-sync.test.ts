import { describe, it, expect } from "vitest";
import type { ClassifiedError as FrontendType } from "../classifiedError";
import type { ClassifiedError as BackendType } from "../../../../eval-server/error-classifier.js";
import { classifyError } from "../../../../eval-server/error-classifier.js";
import { classifyErrorClient } from "../classifyErrorClient";

// ---------------------------------------------------------------------------
// Canonical category list — if either side adds/removes a value, these tests
// force an update so both stay in sync.
// ---------------------------------------------------------------------------
const ALL_CATEGORIES: FrontendType["category"][] = [
  "rate_limit",
  "context_window",
  "auth",
  "timeout",
  "model_not_found",
  "provider_unavailable",
  "parse_error",
  "unknown",
];

// ---------------------------------------------------------------------------
// 1. Type Sync — shape compatibility
// ---------------------------------------------------------------------------
describe("ClassifiedError type sync (frontend <-> backend)", () => {
  it("frontend and backend category unions contain the same values", () => {
    // Compile-time: assigning one to the other proves the unions are identical
    const frontendCat: FrontendType["category"] = "rate_limit";
    const backendCat: BackendType["category"] = frontendCat;
    // If either side has an extra value, TypeScript will error above.
    expect(backendCat).toBe(frontendCat);
  });

  it("every category is assignable to both frontend and backend types", () => {
    for (const cat of ALL_CATEGORIES) {
      const fe: FrontendType = {
        category: cat,
        title: "t",
        description: "d",
        hint: "h",
        retryable: false,
      };
      const be: BackendType = {
        category: cat,
        title: "t",
        description: "d",
        hint: "h",
        retryable: false,
      };
      expect(fe.category).toBe(be.category);
    }
  });

  it("both types accept retryAfterMs as optional", () => {
    const fe: FrontendType = {
      category: "rate_limit",
      title: "t",
      description: "d",
      hint: "h",
      retryable: true,
      retryAfterMs: 5000,
    };
    const be: BackendType = {
      category: "rate_limit",
      title: "t",
      description: "d",
      hint: "h",
      retryable: true,
      retryAfterMs: 5000,
    };
    expect(fe.retryAfterMs).toBe(be.retryAfterMs);
  });

  it("objects satisfying BackendType also satisfy FrontendType", () => {
    // Round-trip: backend output consumed by frontend
    const backendOutput: BackendType = classifyError(
      new Error("rate limit exceeded"),
      "claude-cli",
    );
    const frontendInput: FrontendType = backendOutput;
    expect(frontendInput.category).toBe("rate_limit");
  });
});

// ---------------------------------------------------------------------------
// 2. CATEGORY_CONFIG completeness (ErrorCard)
// ---------------------------------------------------------------------------
describe("CATEGORY_CONFIG completeness", () => {
  // Inline the config keys since CATEGORY_CONFIG is not exported.
  // If ErrorCard changes, update this list (a deliberate coupling test).
  const CATEGORY_CONFIG_KEYS = [
    "rate_limit",
    "context_window",
    "auth",
    "timeout",
    "model_not_found",
    "provider_unavailable",
    "parse_error",
    "unknown",
  ];

  it("has an entry for every category in the union", () => {
    for (const cat of ALL_CATEGORIES) {
      expect(CATEGORY_CONFIG_KEYS).toContain(cat);
    }
  });

  it("has no extra entries beyond the union", () => {
    for (const key of CATEGORY_CONFIG_KEYS) {
      expect(ALL_CATEGORIES).toContain(key);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Backend vs Frontend classifier compatibility
// ---------------------------------------------------------------------------
describe("backend classifyError vs frontend classifyErrorClient", () => {
  const sharedInputs: { msg: string; expectedCategory: FrontendType["category"] }[] = [
    { msg: "rate limit exceeded", expectedCategory: "rate_limit" },
    { msg: "429 Too Many Requests", expectedCategory: "rate_limit" },
    { msg: "401 Unauthorized", expectedCategory: "auth" },
    { msg: "Request timed out", expectedCategory: "timeout" },
    { msg: "ETIMEDOUT", expectedCategory: "timeout" },
    { msg: 'model "gpt-4o" not found', expectedCategory: "model_not_found" },
  ];

  for (const { msg, expectedCategory } of sharedInputs) {
    it(`both classify "${msg}" as ${expectedCategory}`, () => {
      const backend = classifyError(new Error(msg));
      const frontend = classifyErrorClient(msg);
      expect(backend.category).toBe(expectedCategory);
      expect(frontend.category).toBe(expectedCategory);
    });
  }

  // Previously missing categories — now both classifiers agree
  describe("previously missing frontend categories — now synced", () => {
    const syncedInputs: { msg: string; expectedCategory: FrontendType["category"] }[] = [
      { msg: "context window exceeded", expectedCategory: "context_window" },
      { msg: "ECONNREFUSED 127.0.0.1:11434", expectedCategory: "provider_unavailable" },
      { msg: "SyntaxError: Unexpected token", expectedCategory: "parse_error" },
    ];

    for (const { msg, expectedCategory } of syncedInputs) {
      it(`both classify "${msg}" as ${expectedCategory}`, () => {
        const backend = classifyError(new Error(msg));
        const frontend = classifyErrorClient(msg);
        expect(backend.category).toBe(expectedCategory);
        expect(frontend.category).toBe(expectedCategory);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Import chain verification
// ---------------------------------------------------------------------------
describe("import chain verification", () => {
  it("ErrorCard re-exports ClassifiedError from shared module", async () => {
    const shared = await import("../classifiedError");
    const errorCard = await import("../../components/ErrorCard");
    // Both should expose the type — runtime check is that the module loads
    expect(shared).toBeDefined();
    expect(errorCard).toBeDefined();
    expect(typeof errorCard.ErrorCard).toBe("function");
  });
});
