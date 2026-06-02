import { describe, expect, it, vi } from "vitest";

import { installToAgents, startInstallStream } from "./install";

describe("install API desktop multi-agent stream contract", () => {
  async function waitForAssertion(assertion: () => void): Promise<void> {
    let lastError: unknown;
    for (let i = 0; i < 20; i += 1) {
      try {
        assertion();
        return;
      } catch (err) {
        lastError = err;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    throw lastError;
  }

  function sseResponse(frames: string[]): Response {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame));
        controller.close();
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  it("preserves the server-provided multi-agent streamPath", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        jobId: "job-123",
        mode: "multi-agent",
        streamPath: "/api/studio/install-skill/multi/job-123/stream",
      }),
    })) as unknown as typeof fetch;

    const handle = await installToAgents(
      {
        skill: "standard-skill",
        agentIds: ["claude-code", "chatgpt"],
        scope: "user",
      },
      { fetchImpl },
    );

    expect(handle).toEqual({
      jobId: "job-123",
      mode: "multi-agent",
      streamPath: "/api/studio/install-skill/multi/job-123/stream",
    });
  });

  it("subscribes to an explicit multi-agent streamPath with fetch and consumes result frames", async () => {
    const onResult = vi.fn();
    const onDone = vi.fn();
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        `event: result\ndata: ${JSON.stringify({ agentId: "chatgpt", status: "exported" })}\n\n`,
        `event: done\ndata: ${JSON.stringify({
          results: [{ agentId: "chatgpt", status: "exported" }],
          exportedCount: 1,
          errorCount: 0,
        })}\n\n`,
      ]),
    ) as unknown as typeof fetch;

    startInstallStream(
      "/api/studio/install-skill/multi/job-123/stream",
      { onResult, onDone },
      { fetchImpl },
    );

    await waitForAssertion(() => {
      expect(onDone).toHaveBeenCalledTimes(1);
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/studio/install-skill/multi/job-123/stream",
      expect.objectContaining({
        headers: { Accept: "text/event-stream" },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(onResult).toHaveBeenCalledWith({
      agentId: "chatgpt",
      status: "exported",
    });
    expect(onDone).toHaveBeenCalledWith({
      results: [{ agentId: "chatgpt", status: "exported" }],
      exportedCount: 1,
      errorCount: 0,
    });
  });

  it("reports rejected stream responses instead of hanging the modal", async () => {
    const onResult = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();
    const fetchImpl = vi.fn(async () =>
      new Response("unauthorized", {
        status: 401,
        statusText: "Unauthorized",
      }),
    ) as unknown as typeof fetch;

    startInstallStream(
      "/api/studio/install-skill/multi/job-401/stream",
      { onResult, onDone, onError },
      { fetchImpl },
    );

    await waitForAssertion(() => {
      expect(onError).toHaveBeenCalledTimes(1);
    });

    expect(onResult).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect((onError.mock.calls[0]?.[0] as Error).message).toContain("HTTP 401");
  });
});
