import { describe, it, expect, vi } from "vitest";
import { withHeartbeat, sendSSE } from "../sse-helpers.js";
import type { ServerResponse } from "node:http";

// Test that withHeartbeat emits progress events during long-running calls (T-012 / 0566)
describe("withHeartbeat for activation-prompts (T-012 / 0566)", () => {
  it("emits progress event before done when call exceeds interval", async () => {
    vi.useFakeTimers();

    const sseWrites: Array<{ event: string; data: unknown }> = [];
    const mockRes = {
      write: vi.fn((chunk: string) => {
        // Parse SSE format
        const lines = chunk.split("\n");
        let event = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) event = line.slice(7);
          if (line.startsWith("data: ")) {
            sseWrites.push({ event, data: JSON.parse(line.slice(6)) });
          }
        }
        return true;
      }),
      writableEnded: false,
    } as unknown as ServerResponse;

    // Simulate a long-running generate call (resolves after timer advancement)
    let resolveGenerate!: (val: { text: string }) => void;
    const generatePromise = new Promise<{ text: string }>((res) => { resolveGenerate = res; });

    const resultPromise = withHeartbeat(
      mockRes,
      undefined,
      "generating",
      "Generating test prompts...",
      () => generatePromise,
    );

    // Advance past the 3s heartbeat interval
    await vi.advanceTimersByTimeAsync(3100);

    // Now resolve the generate call
    resolveGenerate({ text: '{"prompt": "test", "expected": "should_activate"}' });
    const result = await resultPromise;

    vi.useRealTimers();

    // Verify at least one progress event was emitted before the result
    const progressEvents = sseWrites.filter((e) => e.event === "progress");
    expect(progressEvents.length).toBeGreaterThanOrEqual(1);
    expect(progressEvents[0].data).toHaveProperty("phase", "generating");
    expect(progressEvents[0].data).toHaveProperty("message");
    expect(result.text).toContain("test");
  });

  it("does not emit heartbeat when call completes quickly", async () => {
    vi.useFakeTimers();

    const sseWrites: Array<{ event: string; data: unknown }> = [];
    const mockRes = {
      write: vi.fn((chunk: string) => {
        const lines = chunk.split("\n");
        let event = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) event = line.slice(7);
          if (line.startsWith("data: ")) {
            sseWrites.push({ event, data: JSON.parse(line.slice(6)) });
          }
        }
        return true;
      }),
      writableEnded: false,
    } as unknown as ServerResponse;

    const result = await withHeartbeat(
      mockRes,
      undefined,
      "generating",
      "Generating test prompts...",
      async () => ({ text: "quick result" }),
    );

    vi.useRealTimers();

    const progressEvents = sseWrites.filter((e) => e.event === "progress");
    expect(progressEvents).toHaveLength(0);
    expect(result.text).toBe("quick result");
  });
});
