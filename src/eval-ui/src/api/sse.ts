type FetchLike = typeof fetch;

export interface FetchEventStreamEvent {
  event: string;
  data: string;
}

export interface FetchEventStreamHandle {
  close: () => void;
}

export interface FetchEventStreamOptions {
  fetchImpl?: FetchLike;
  onEvent: (event: FetchEventStreamEvent) => void;
  onError?: (err: Error) => void;
  /**
   * Invoked when the upstream SSE ends CLEANLY (reader returns done===true)
   * and the close was NOT client-initiated (i.e. the consumer did not call
   * the returned `close()`). This is exactly what a Cloudflare Worker isolate
   * recycle / deploy / idle-evict produces: no thrown error, the stream just
   * ends. Consumers should treat this like a transient drop and reconnect.
   *
   * NOT called when the consumer calls `close()` (e.g. on unmount) — that is a
   * deliberate teardown, not a server-side drop.
   */
  onClose?: () => void;
  timeoutMs?: number;
  timeoutMessage?: string;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === "AbortError"
    : err instanceof Error && err.name === "AbortError";
}

function parseFrame(rawFrame: string): FetchEventStreamEvent | null {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of rawFrame.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const separatorIndex = line.indexOf(":");
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    const rawValue = separatorIndex === -1 ? "" : line.slice(separatorIndex + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

    if (field === "event") {
      event = value || "message";
    } else if (field === "data") {
      dataLines.push(value);
    }
  }

  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

function consumeFrames(
  buffer: string,
  onEvent: (event: FetchEventStreamEvent) => void,
): string {
  let normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let frameEnd = normalized.indexOf("\n\n");

  while (frameEnd !== -1) {
    const rawFrame = normalized.slice(0, frameEnd);
    normalized = normalized.slice(frameEnd + 2);
    const event = parseFrame(rawFrame);
    if (event) onEvent(event);
    frameEnd = normalized.indexOf("\n\n");
  }

  return normalized;
}

export function openFetchEventStream(
  url: string,
  opts: FetchEventStreamOptions,
): FetchEventStreamHandle {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(safetyTimer);
    controller.abort();
  };

  const safetyTimer = setTimeout(() => {
    if (closed) return;
    const err = new Error(opts.timeoutMessage ?? "SSE stream timed out");
    close();
    opts.onError?.(err);
  }, opts.timeoutMs ?? 200_000);

  void (async () => {
    try {
      const res = await fetchImpl(url, {
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (!res.ok) {
        const statusText = res.statusText ? ` ${res.statusText}` : "";
        throw new Error(`SSE stream failed: HTTP ${res.status}${statusText}`);
      }
      if (!res.body) {
        throw new Error("SSE stream failed: response body is empty");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer = consumeFrames(buffer + decoder.decode(value, { stream: true }), opts.onEvent);
      }

      const tail = decoder.decode();
      if (tail || buffer) consumeFrames(`${buffer}${tail}\n\n`, opts.onEvent);
      clearTimeout(safetyTimer);
      // Distinguish a server-side clean close from a client-initiated one.
      // `close()` sets `closed=true` BEFORE aborting, so if we reach this point
      // with `closed` still false the stream ended on its own (CF isolate
      // recycle / deploy / idle-evict): notify onClose so the consumer can
      // reconnect. A client-initiated close already has closed===true → no
      // callback (deliberate teardown, e.g. unmount).
      const serverClosed = !closed;
      closed = true;
      if (serverClosed) opts.onClose?.();
    } catch (err) {
      clearTimeout(safetyTimer);
      if (closed && isAbortError(err)) return;
      closed = true;
      opts.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return { close };
}
