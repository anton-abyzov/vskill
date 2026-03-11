import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startDynamicHeartbeat, withHeartbeat } from "../sse-helpers.js";

function mockRes() {
  return { write: vi.fn() } as any;
}

function parseSSE(call: string): { event: string; data: Record<string, unknown> } {
  const eventMatch = call.match(/^event: (.+)\n/);
  const dataMatch = call.match(/data: (.+)\n/);
  return {
    event: eventMatch?.[1] ?? "",
    data: dataMatch ? JSON.parse(dataMatch[1]) : {},
  };
}

describe("startDynamicHeartbeat", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("returns an object with update and stop methods", () => {
    const res = mockRes();
    const hb = startDynamicHeartbeat(res, 1, "generating_skill", "Generating skill output...");
    expect(typeof hb.update).toBe("function");
    expect(typeof hb.stop).toBe("function");
    hb.stop();
  });

  it("emits progress events at interval with initial phase", () => {
    const res = mockRes();
    const hb = startDynamicHeartbeat(res, 1, "generating_skill", "Generating skill output...", 1000);

    vi.advanceTimersByTime(1000);
    expect(res.write).toHaveBeenCalledTimes(1);
    const { event, data } = parseSSE(res.write.mock.calls[0][0]);
    expect(event).toBe("progress");
    expect(data.phase).toBe("generating_skill");
    expect(data.message).toContain("Generating skill output...");
    expect(data.eval_id).toBe(1);

    hb.stop();
  });

  it("update() switches phase and emits immediately", () => {
    const res = mockRes();
    const hb = startDynamicHeartbeat(res, 1, "generating_skill", "Generating skill output...", 3000);

    hb.update("generating_baseline", "Generating baseline output...");
    expect(res.write).toHaveBeenCalledTimes(1);
    const { data } = parseSSE(res.write.mock.calls[0][0]);
    expect(data.phase).toBe("generating_baseline");
    expect(data.message).toContain("Generating baseline output...");

    hb.stop();
  });

  it("next interval tick uses updated phase after update()", () => {
    const res = mockRes();
    const hb = startDynamicHeartbeat(res, 1, "generating_skill", "Generating skill output...", 1000);

    hb.update("scoring", "Scoring comparison...");
    res.write.mockClear();

    vi.advanceTimersByTime(1000);
    expect(res.write).toHaveBeenCalledTimes(1);
    const { data } = parseSSE(res.write.mock.calls[0][0]);
    expect(data.phase).toBe("scoring");
    expect(data.message).toContain("Scoring comparison...");

    hb.stop();
  });

  it("stop() clears the interval — no further events emitted", () => {
    const res = mockRes();
    const hb = startDynamicHeartbeat(res, 1, "phase1", "msg", 1000);

    hb.stop();
    vi.advanceTimersByTime(5000);
    expect(res.write).not.toHaveBeenCalled();
  });

  it("stop() is idempotent — calling twice does not throw", () => {
    const res = mockRes();
    const hb = startDynamicHeartbeat(res, 1, "phase1", "msg", 1000);

    expect(() => {
      hb.stop();
      hb.stop();
    }).not.toThrow();
  });

  it("elapsed_ms increments across ticks", () => {
    const res = mockRes();
    const hb = startDynamicHeartbeat(res, 1, "phase1", "msg", 1000);

    vi.advanceTimersByTime(1000);
    const { data: d1 } = parseSSE(res.write.mock.calls[0][0]);

    vi.advanceTimersByTime(1000);
    const { data: d2 } = parseSSE(res.write.mock.calls[1][0]);

    expect((d2.elapsed_ms as number)).toBeGreaterThan((d1.elapsed_ms as number));

    hb.stop();
  });

  it("includes eval_id when provided", () => {
    const res = mockRes();
    const hb = startDynamicHeartbeat(res, 42, "phase1", "msg", 1000);

    vi.advanceTimersByTime(1000);
    const { data } = parseSSE(res.write.mock.calls[0][0]);
    expect(data.eval_id).toBe(42);

    hb.stop();
  });

  it("omits eval_id when undefined", () => {
    const res = mockRes();
    const hb = startDynamicHeartbeat(res, undefined, "phase1", "msg", 1000);

    vi.advanceTimersByTime(1000);
    const { data } = parseSSE(res.write.mock.calls[0][0]);
    expect(data).not.toHaveProperty("eval_id");

    hb.stop();
  });
});

describe("withHeartbeat (regression guard)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("emits heartbeat events and resolves the promise", async () => {
    const res = mockRes();
    const resultPromise = withHeartbeat(res, 5, "generating", "Working...", async () => {
      await new Promise((r) => setTimeout(r, 5000));
      return "done";
    }, 1000);

    vi.advanceTimersByTime(2000);
    expect(res.write).toHaveBeenCalledTimes(2);
    const { data } = parseSSE(res.write.mock.calls[0][0]);
    expect(data.phase).toBe("generating");
    expect(data.eval_id).toBe(5);

    vi.advanceTimersByTime(3000);
    const result = await resultPromise;
    expect(result).toBe("done");
  });

  it("clears interval after fn resolves", async () => {
    const res = mockRes();
    const resultPromise = withHeartbeat(res, undefined, "p", "m", async () => "ok", 1000);

    const result = await resultPromise;
    expect(result).toBe("ok");

    res.write.mockClear();
    vi.advanceTimersByTime(5000);
    expect(res.write).not.toHaveBeenCalled();
  });
});
