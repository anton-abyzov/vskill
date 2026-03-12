// ---------------------------------------------------------------------------
// Tests: applySSEToAccumulator — event-processing logic for handleSSEEvent
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { applySSEToAccumulator } from "../pages/workspace/WorkspaceContext.js";
import type { InlineResult } from "../pages/workspace/workspaceTypes.js";
import type { SSEEvent } from "../sse.js";

function makeAcc(overrides: Partial<InlineResult> = {}): InlineResult {
  return { assertions: [], ...overrides };
}

function makeEvent(event: string, data: Record<string, unknown>): SSEEvent {
  return { event, data } as SSEEvent;
}

describe("applySSEToAccumulator — outputs_ready event", () => {
  it("sets output from skillOutput", () => {
    const r = makeAcc();
    applySSEToAccumulator(r, makeEvent("outputs_ready", { skillOutput: "hello world" }));
    expect(r.output).toBe("hello world");
  });

  it("sets durationMs from skillDurationMs when present", () => {
    const r = makeAcc();
    applySSEToAccumulator(r, makeEvent("outputs_ready", { skillOutput: "x", skillDurationMs: 1200 }));
    expect(r.durationMs).toBe(1200);
  });

  it("sets tokens from skillTokens when present", () => {
    const r = makeAcc();
    applySSEToAccumulator(r, makeEvent("outputs_ready", { skillOutput: "x", skillTokens: 500 }));
    expect(r.tokens).toBe(500);
  });

  it("does not overwrite durationMs when skillDurationMs is absent", () => {
    const r = makeAcc({ durationMs: 999 });
    applySSEToAccumulator(r, makeEvent("outputs_ready", { skillOutput: "x" }));
    expect(r.durationMs).toBe(999);
  });

  it("does not overwrite tokens when skillTokens is absent", () => {
    const r = makeAcc({ tokens: 42 });
    applySSEToAccumulator(r, makeEvent("outputs_ready", { skillOutput: "x" }));
    expect(r.tokens).toBe(42);
  });
});

describe("applySSEToAccumulator — full comparison SSE sequence (T-003)", () => {
  it("populates card with assertions and pass rate after outputs_ready → assertion_result × 2 → case_complete", () => {
    const r = makeAcc();
    applySSEToAccumulator(r, makeEvent("outputs_ready", { skillOutput: "skill answer", skillDurationMs: 5000, skillTokens: 200 }));
    applySSEToAccumulator(r, makeEvent("assertion_result", { assertion_id: "a1", text: "includes X", pass: true, reasoning: "yes" }));
    applySSEToAccumulator(r, makeEvent("assertion_result", { assertion_id: "a2", text: "uses Y", pass: false, reasoning: "no" }));
    applySSEToAccumulator(r, makeEvent("case_complete", { status: "fail", pass_rate: 0.5 }));

    expect(r.output).toBe("skill answer");
    expect(r.durationMs).toBe(5000);
    expect(r.tokens).toBe(200);
    expect(r.assertions).toHaveLength(2);
    expect(r.assertions[0]).toMatchObject({ assertion_id: "a1", pass: true });
    expect(r.assertions[1]).toMatchObject({ assertion_id: "a2", pass: false });
    expect(r.status).toBe("fail");
    expect(r.passRate).toBe(0.5);
  });

  it("deduplicates duplicate assertion_result events (same assertion_id)", () => {
    const r = makeAcc();
    applySSEToAccumulator(r, makeEvent("assertion_result", { assertion_id: "a1", text: "check", pass: true, reasoning: "ok" }));
    applySSEToAccumulator(r, makeEvent("assertion_result", { assertion_id: "a1", text: "check", pass: true, reasoning: "ok" }));
    expect(r.assertions).toHaveLength(1);
  });
});

describe("applySSEToAccumulator — existing event types (regression)", () => {
  it("still handles output_ready (singular) correctly", () => {
    const r = makeAcc();
    applySSEToAccumulator(r, makeEvent("output_ready", { output: "the output", durationMs: 100, tokens: 50 }));
    expect(r.output).toBe("the output");
    expect(r.durationMs).toBe(100);
    expect(r.tokens).toBe(50);
  });

  it("still handles assertion_result correctly", () => {
    const r = makeAcc();
    applySSEToAccumulator(r, makeEvent("assertion_result", {
      assertion_id: "a1", text: "check", pass: true, reasoning: "ok",
    }));
    expect(r.assertions).toHaveLength(1);
    expect(r.assertions[0].assertion_id).toBe("a1");
    expect(r.assertions[0].pass).toBe(true);
  });

  it("still handles case_complete correctly", () => {
    const r = makeAcc();
    applySSEToAccumulator(r, makeEvent("case_complete", { status: "pass", pass_rate: 0.8 }));
    expect(r.status).toBe("pass");
    expect(r.passRate).toBe(0.8);
  });
});
