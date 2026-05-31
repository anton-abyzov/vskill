// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Finding 1 — openFetchEventStream onClose semantics.
//
// A clean upstream SSE close (reader.read() → done===true, NO thrown error —
// exactly what a Cloudflare Worker isolate recycle / deploy / idle-evict
// produces) must invoke opts.onClose so the consumer can reconnect. A
// CLIENT-initiated close (consumer calls the returned handle.close()) must NOT
// invoke onClose — it's a deliberate teardown (e.g. React unmount).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { openFetchEventStream } from "../api/sse";

/** A controllable SSE response: tests drive enqueue/close/error explicitly. */
function makeStreamResponse(): {
  response: Response;
  enqueue: (text: string) => void;
  closeServer: () => void;
} {
  const encoder = new TextEncoder();
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
  });
  const response = new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
  return {
    response,
    enqueue: (text: string) => ctrl.enqueue(encoder.encode(text)),
    closeServer: () => ctrl.close(),
  };
}

async function tick() {
  // Let the async reader loop advance past pending microtasks.
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe("openFetchEventStream — onClose vs client close", () => {
  it("invokes onClose (not onError) when the server closes the stream CLEANLY", async () => {
    const { response, enqueue, closeServer } = makeStreamResponse();
    const fetchImpl = vi.fn(async () => response) as unknown as typeof fetch;

    const onClose = vi.fn();
    const onError = vi.fn();
    const onEvent = vi.fn();

    openFetchEventStream("/api/v1/submissions/stream?mine=1", {
      fetchImpl,
      onEvent,
      onError,
      onClose,
    });

    await tick();
    enqueue("data: hello\n\n");
    await tick();
    expect(onEvent).toHaveBeenCalledTimes(1);

    // Server ends the stream cleanly — no error thrown.
    closeServer();
    await tick();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("does NOT invoke onClose when the consumer calls handle.close() (client-initiated)", async () => {
    const { response, enqueue } = makeStreamResponse();
    const fetchImpl = vi.fn(async () => response) as unknown as typeof fetch;

    const onClose = vi.fn();
    const onError = vi.fn();

    const handle = openFetchEventStream("/api/v1/submissions/stream?mine=1", {
      fetchImpl,
      onEvent: vi.fn(),
      onError,
      onClose,
    });

    await tick();
    enqueue("data: hi\n\n");
    await tick();

    // Consumer tears the stream down deliberately (e.g. React unmount).
    handle.close();
    await tick();

    expect(onClose).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("still routes a thrown/HTTP error to onError, not onClose", async () => {
    const errorResponse = new Response("nope", { status: 500, statusText: "Server Error" });
    const fetchImpl = vi.fn(async () => errorResponse) as unknown as typeof fetch;

    const onClose = vi.fn();
    const onError = vi.fn();

    openFetchEventStream("/api/v1/submissions/stream?mine=1", {
      fetchImpl,
      onEvent: vi.fn(),
      onError,
      onClose,
    });

    await tick();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
