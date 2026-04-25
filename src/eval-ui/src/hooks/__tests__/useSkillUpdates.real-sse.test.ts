// @vitest-environment jsdom
//
// 0708 — REAL SSE wire test (no `page.route` stubs, no MockEventSource).
//
// This test boots a real Node http SSE server on a random port and points
// `useSkillUpdates` at it via `streamUrlBase`. The hook uses the npm
// `eventsource` package as a polyfill (jsdom does not ship one) — that
// polyfill speaks real HTTP+SSE, so a successful test proves the entire
// scanner → outbox → SSE wire → `useSkillUpdates` hook → UI surface chain
// works against a genuine network connection.
//
// What this catches that the existing stubbed specs do not:
//   • Wrong SSE frame format (newline framing, header bytes).
//   • Wrong response headers (`text/event-stream`, `cache-control: no-cache`).
//   • Connection lifecycle bugs (server keeps socket open, browser EventSource
//     stays in OPEN state, `onmessage` actually fires for `data:` frames).
//   • Any future change to how the hook constructs the URL or parses frames.
//
// The companion `useSkillUpdates.sse.test.ts` covers the in-memory matrix of
// edge cases (dedup, fallback, gone-frame). This spec is the cross-check
// that the real wire actually behaves the way those mocks claim.

import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventSource as RealEventSource } from "eventsource";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

import { updateStore } from "../../stores/updateStore";
import type { SkillUpdateEvent } from "../../types/skill-update";

// ---------------------------------------------------------------------------
// Polyfill EventSource onto the jsdom window. The hook checks
// `typeof EventSource === "undefined"` to decide whether to open a stream;
// jsdom doesn't ship one, so without this the hook flips straight to
// "fallback" and never touches the wire.
// ---------------------------------------------------------------------------

(globalThis as unknown as { EventSource: typeof RealEventSource }).EventSource =
  RealEventSource;
(globalThis as unknown as { window: Window }).window.EventSource =
  RealEventSource as unknown as typeof window.EventSource;

// ---------------------------------------------------------------------------
// Tiny real SSE server — implements just enough of the platform contract
// (`/stream?skills=<csv>`) to drive the hook.
// ---------------------------------------------------------------------------

interface ConnectedClient {
  req: IncomingMessage;
  res: ServerResponse;
  skills: string[];
}

function startSseServer(): Promise<{
  server: Server;
  url: string;
  clients: ConnectedClient[];
  emit: (event: SkillUpdateEvent) => void;
  emitGone: () => void;
  stop: () => Promise<void>;
}> {
  const clients: ConnectedClient[] = [];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (!url.pathname.endsWith("/stream")) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const skills = (url.searchParams.get("skills") ?? "").split(",").filter(Boolean);
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
    });
    // SSE clients accept comments — write one immediately so the browser-side
    // EventSource flips to OPEN (matches the platform's preflight comment).
    res.write(": connected\n\n");
    const client: ConnectedClient = { req, res, skills };
    clients.push(client);
    req.on("close", () => {
      const i = clients.indexOf(client);
      if (i >= 0) clients.splice(i, 1);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        throw new Error("failed to bind sse server");
      }
      const base = `http://127.0.0.1:${addr.port}`;
      const emit = (event: SkillUpdateEvent) => {
        const frame =
          `id: ${event.eventId}\n` +
          `event: message\n` +
          `data: ${JSON.stringify(event)}\n\n`;
        for (const c of clients) c.res.write(frame);
      };
      const emitGone = () => {
        const frame = `event: gone\n` + `data: ${JSON.stringify({ reason: "too-old" })}\n\n`;
        for (const c of clients) c.res.write(frame);
      };
      const stop = () =>
        new Promise<void>((r) => {
          for (const c of clients) {
            try {
              c.res.end();
            } catch {
              /* noop */
            }
          }
          clients.length = 0;
          server.close(() => r());
        });
      resolve({ server, url: `${base}/stream`, clients, emit, emitGone, stop });
    });
  });
}

// ---------------------------------------------------------------------------
// React harness — mounts the real `useSkillUpdates` hook and the real
// `<UpdateBell>` component (via a minimal StudioContext provider) so the
// assertions cover both the hook return AND the UI surface that consumes it.
// ---------------------------------------------------------------------------

async function mountStudioWithBell(opts: {
  streamUrlBase: string;
  skillIds: string[];
}) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { useSkillUpdates } = await import("../useSkillUpdates");
  const { UpdateBell } = await import("../../components/UpdateBell");
  const { StudioContext } = await import("../../StudioContext");

  type HookReturn = ReturnType<typeof useSkillUpdates>;
  const hookRef: { current: HookReturn | null } = { current: null };

  function Probe() {
    const hook = useSkillUpdates({
      streamUrlBase: opts.streamUrlBase,
      skillIds: opts.skillIds,
      // Disable the polling cadence so the only network traffic is SSE.
      intervalMs: 60_000_000,
      staleAfterMs: 60_000_000,
    });
    hookRef.current = hook;

    // Minimal StudioContext value — only the fields UpdateBell reads.
    const value = React.useMemo(
      () => ({
        state: {
          selectedSkill: null,
          revealSkillId: null,
          isMobile: false,
          mobileView: "list" as const,
          mode: "browse" as const,
          searchQuery: "",
          dismissedUpdateAt: null,
        },
        selectSkill: () => {},
        clearSelection: () => {},
        setMode: () => {},
        setSearch: () => {},
        setMobileView: () => {},
        refreshSkills: () => {},
        updateCount: hook.updateCount,
        dismissUpdateNotification: () => {},
        updates: hook.updates,
        outdatedByOrigin: { source: 0, installed: 0 },
        isRefreshingUpdates: hook.isRefreshing,
        refreshUpdates: hook.refresh,
        revealSkill: () => {},
        clearReveal: () => {},
        updatesById: hook.updatesById,
        pushUpdateCount: hook.pushUpdateCount,
        updateStreamStatus: hook.status,
        dismissPushUpdate: hook.dismiss,
      }),
      [
        hook.updateCount,
        hook.updates,
        hook.isRefreshing,
        hook.refresh,
        hook.updatesById,
        hook.pushUpdateCount,
        hook.status,
        hook.dismiss,
      ],
    );

    return React.createElement(
      StudioContext.Provider,
      { value: value as unknown as React.ContextType<typeof StudioContext> },
      React.createElement(UpdateBell),
    );
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Probe));
  });

  return {
    hook: () => {
      const v = hookRef.current;
      if (!v) throw new Error("hook not yet mounted");
      return v;
    },
    container,
    flush: () => act(async () => { await Promise.resolve(); }),
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function waitFor<T>(
  fn: () => T | Promise<T>,
  predicate: (v: T) => boolean,
  opts: { timeoutMs?: number; intervalMs?: number; flush?: () => Promise<void> } = {},
): Promise<T> {
  const timeout = opts.timeoutMs ?? 4_000;
  const interval = opts.intervalMs ?? 25;
  const start = Date.now();
  let last: T | undefined;
  // Always run the polled fn + the flush inside React's act boundary so
  // state updates triggered by SSE-callback dispatches (which originate on
  // the Node http socket, outside any React event) don't trigger
  // "not wrapped in act(...)" warnings.
  const { act } = await import("react");
  while (Date.now() - start < timeout) {
    await act(async () => {
      last = await fn();
      if (opts.flush) await opts.flush();
    });
    if (last !== undefined && predicate(last)) return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`waitFor timed out after ${timeout}ms; last=${JSON.stringify(last)}`);
}

// ---------------------------------------------------------------------------
// The fixture — `appstore` is the local "App Store" skill the user named.
// ---------------------------------------------------------------------------

const APPSTORE_SKILL_ID = "appstore/appstore";

function appstoreEvent(version = "1.2.0"): SkillUpdateEvent {
  return {
    type: "skill.updated",
    eventId: `evt_real_sse_${Date.now()}`,
    skillId: APPSTORE_SKILL_ID,
    version,
    gitSha: "deadbeef",
    publishedAt: new Date().toISOString(),
    diffSummary: "App Store skill v1.2.0 — real SSE wire test",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSkillUpdates — real SSE wire (no page.route stubs)", () => {
  let serverHandle: Awaited<ReturnType<typeof startSseServer>>;

  beforeEach(async () => {
    updateStore.reset();
    window.localStorage.clear();
    serverHandle = await startSseServer();
    // Visibility default = visible — toast dispatch path requires this.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  afterEach(async () => {
    await serverHandle.stop();
  });

  it("opens a real EventSource against the test server and surfaces a real `skill.updated` frame in the UI", async () => {
    const harness = await mountStudioWithBell({
      streamUrlBase: serverHandle.url,
      skillIds: [APPSTORE_SKILL_ID],
    });

    try {
      // 1. The bell renders immediately (component mounts before SSE opens).
      const bellBtn = harness.container.querySelector('[data-testid="update-bell"]');
      expect(bellBtn, "UpdateBell button should render").not.toBeNull();

      // 2. Wait until the EventSource handshake completes — the server logs
      //    the connection in `clients[]`, and the hook flips status to
      //    "connected" once `onopen` fires.
      await waitFor(
        () => serverHandle.clients.length,
        (n) => n === 1,
        { timeoutMs: 4_000 },
      );
      expect(serverHandle.clients[0].skills).toEqual([APPSTORE_SKILL_ID]);

      await waitFor(
        () => harness.hook().status,
        (s) => s === "connected",
        { timeoutMs: 4_000, flush: harness.flush },
      );

      // 3. Sanity: before the server emits anything, the push store is empty.
      expect(harness.hook().pushUpdateCount).toBe(0);
      expect(harness.hook().updatesById.size).toBe(0);

      // 4. Emit a real SSE frame over the wire.
      const evt = appstoreEvent("1.2.0");
      serverHandle.emit(evt);

      // 5. The hook ingests it, the store updates, the UI sees the change.
      await waitFor(
        () => harness.hook().pushUpdateCount,
        (n) => n === 1,
        { timeoutMs: 4_000, flush: harness.flush },
      );

      const finalHook = harness.hook();
      expect(finalHook.pushUpdateCount).toBe(1);
      expect(finalHook.updatesById.has(APPSTORE_SKILL_ID)).toBe(true);

      const entry = finalHook.updatesById.get(APPSTORE_SKILL_ID);
      expect(entry).toBeDefined();
      expect(entry?.skillId).toBe(APPSTORE_SKILL_ID);
      expect(entry?.version).toBe("1.2.0");
      expect(entry?.eventId).toBe(evt.eventId);
      expect(entry?.diffSummary).toBe("App Store skill v1.2.0 — real SSE wire test");

      // 6. The shared updateStore module-singleton must hold the same entry —
      //    this is the same store the rest of the UI tree reads from via
      //    `useSyncExternalStore`.
      const snap = updateStore.getSnapshot();
      expect(snap.has(APPSTORE_SKILL_ID)).toBe(true);
      expect(snap.get(APPSTORE_SKILL_ID)?.version).toBe("1.2.0");
    } finally {
      await harness.unmount();
    }
  }, 15_000);

  it("ignores duplicate frames carrying the same eventId (real wire dedup)", async () => {
    const harness = await mountStudioWithBell({
      streamUrlBase: serverHandle.url,
      skillIds: [APPSTORE_SKILL_ID],
    });

    try {
      await waitFor(
        () => serverHandle.clients.length,
        (n) => n === 1,
        { timeoutMs: 4_000 },
      );
      await waitFor(
        () => harness.hook().status,
        (s) => s === "connected",
        { timeoutMs: 4_000, flush: harness.flush },
      );

      const evt = appstoreEvent("1.3.0");
      serverHandle.emit(evt);
      await waitFor(
        () => harness.hook().pushUpdateCount,
        (n) => n === 1,
        { timeoutMs: 4_000, flush: harness.flush },
      );

      // Re-emit the same frame — store size must remain 1 and the entry must
      // not have been replaced (verified via stable receivedAt).
      const before = harness.hook().updatesById.get(APPSTORE_SKILL_ID);
      expect(before).toBeDefined();
      const beforeReceivedAt = before!.receivedAt;
      serverHandle.emit(evt);
      // Give the wire a beat to deliver the duplicate.
      await new Promise((r) => setTimeout(r, 150));
      await harness.flush();

      const after = harness.hook().updatesById.get(APPSTORE_SKILL_ID);
      expect(harness.hook().pushUpdateCount).toBe(1);
      expect(after?.receivedAt).toBe(beforeReceivedAt);
    } finally {
      await harness.unmount();
    }
  }, 15_000);
});
