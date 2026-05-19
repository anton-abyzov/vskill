import { describe, expect, it, vi } from "vitest";

import { installToAgents, startInstallStream } from "./install";

describe("install API desktop multi-agent stream contract", () => {
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

  it("subscribes to an explicit multi-agent streamPath and consumes result frames", () => {
    type Listener = (ev: MessageEvent) => void;
    class FakeEventSource {
      static instances: FakeEventSource[] = [];
      listeners = new Map<string, Listener[]>();
      closed = false;
      onerror: (() => void) | null = null;

      constructor(readonly url: string) {
        FakeEventSource.instances.push(this);
      }

      addEventListener(type: string, cb: Listener): void {
        const list = this.listeners.get(type) ?? [];
        list.push(cb);
        this.listeners.set(type, list);
      }

      emit(type: string, data: unknown): void {
        const ev = { data: JSON.stringify(data) } as MessageEvent;
        for (const cb of this.listeners.get(type) ?? []) cb(ev);
      }

      close(): void {
        this.closed = true;
      }
    }

    const onResult = vi.fn();
    const onDone = vi.fn();

    startInstallStream(
      "/api/studio/install-skill/multi/job-123/stream",
      { onResult, onDone },
      { eventSourceCtor: FakeEventSource as unknown as typeof EventSource },
    );

    const source = FakeEventSource.instances[0];
    expect(source.url).toBe("/api/studio/install-skill/multi/job-123/stream");

    source.emit("result", { agentId: "chatgpt", status: "exported" });
    source.emit("done", {
      results: [{ agentId: "chatgpt", status: "exported" }],
      exportedCount: 1,
      errorCount: 0,
    });

    expect(onResult).toHaveBeenCalledWith({
      agentId: "chatgpt",
      status: "exported",
    });
    expect(onDone).toHaveBeenCalledWith({
      results: [{ agentId: "chatgpt", status: "exported" }],
      exportedCount: 1,
      errorCount: 0,
    });
    expect(source.closed).toBe(true);
  });
});
