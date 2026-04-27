// @vitest-environment jsdom
//
// T-025 / AC-US3-03 — real-SSE slug-ID subscriber test (0732).
//
// Proves the dual-accept path end-to-end: the Studio hook subscribes using a
// slug ID (`sk_published_acme/foo/bar`) while the server emits events that
// carry both `skillId` (UUID) and `skillSlug`. The `<UpdateBell>` badge must
// increment to 1, confirming the entire wire path works for slug-subscribed
// clients without UUID knowledge.
//
// Pattern mirrors `useSkillUpdates.real-sse.test.ts` shipped on 2026-04-25
// (0708 closure). No new test infrastructure is introduced.

import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventSource as RealEventSource } from "eventsource";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// UpdateBell consumes useToast for the no-match owning-agent fallback. This
// hook test renders <UpdateBell> without a real <ToastProvider> ancestor, so
// stub the provider module — same pattern as the existing component tests
// (see src/eval-ui/src/components/__tests__/UpdateBell.test.tsx).
vi.mock("../../components/ToastProvider", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), clear: vi.fn() }),
}));

// Stub the platform-health hook so its fetch loop doesn't keep this test's
// microtask queue alive forever (manifests as worker OOM). Same rationale
// as UpdateBell.test.tsx (0778).
vi.mock("../usePlatformHealth", () => ({
  usePlatformHealth: () => ({
    data: { degraded: false, reason: null, statsAgeMs: 0, oldestActiveAgeMs: 0 },
    loading: false,
  }),
}));

import { updateStore } from "../../stores/updateStore";
import type { SkillUpdateEvent } from "../../types/skill-update";

(globalThis as unknown as { EventSource: typeof RealEventSource }).EventSource =
  RealEventSource;
(globalThis as unknown as { window: Window }).window.EventSource =
  RealEventSource as unknown as typeof window.EventSource;

// ---------------------------------------------------------------------------
// Minimal SSE server — same contract as the companion test.
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
      const stop = () =>
        new Promise<void>((r) => {
          for (const c of clients) {
            try { c.res.end(); } catch { /* noop */ }
          }
          clients.length = 0;
          server.close(() => r());
        });
      resolve({ server, url: `${base}/stream`, clients, emit, stop });
    });
  });
}

// ---------------------------------------------------------------------------
// React harness — mounts `useSkillUpdates` + `<UpdateBell>`.
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
      intervalMs: 60_000_000,
      staleAfterMs: 60_000_000,
    });
    hookRef.current = hook;

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
  await act(async () => { root.render(React.createElement(Probe)); });

  return {
    hook: () => {
      const v = hookRef.current;
      if (!v) throw new Error("hook not yet mounted");
      return v;
    },
    container,
    flush: () => act(async () => { await Promise.resolve(); }),
    unmount: async () => {
      await act(async () => { root.unmount(); });
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
// Fixtures
// ---------------------------------------------------------------------------

// The hook subscribes using the slug; the server emits with UUID + slug.
const SLUG_ID = "sk_published_acme/foo/bar";
const UUID_ID = "uuid-acme-foo-bar-0001";

function makeSlugEvent(version = "2.0.0"): SkillUpdateEvent {
  return {
    type: "skill.updated",
    eventId: `evt_slug_sse_${Date.now()}`,
    skillId: UUID_ID,
    skillSlug: SLUG_ID,
    version,
    gitSha: "cafebabe",
    publishedAt: new Date().toISOString(),
    diffSummary: "slug-subscriber dual-accept test",
  };
}

// ---------------------------------------------------------------------------
// Tests — T-025 / AC-US3-03
// ---------------------------------------------------------------------------

describe("useSkillUpdates — slug-ID subscriber real-SSE (T-025 / AC-US3-03)", () => {
  let serverHandle: Awaited<ReturnType<typeof startSseServer>>;

  beforeEach(async () => {
    updateStore.reset();
    window.localStorage.clear();
    serverHandle = await startSseServer();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  afterEach(async () => {
    await serverHandle.stop();
  });

  it("AC-US3-03: slug-subscribed hook surfaces skill.updated frame when server emits UUID+slug event", async () => {
    // The hook subscribes using the slug ID (the format the discovery API
    // returns). The server emits an event augmented with both UUID and slug
    // (mirrors what the 0732 publish endpoint does via augmentWithSlug).
    // The test asserts that the UpdateBell badge increments to 1, proving
    // the dual-accept path works end-to-end on the real SSE wire.
    const harness = await mountStudioWithBell({
      streamUrlBase: serverHandle.url,
      skillIds: [SLUG_ID],
    });

    try {
      const bellBtn = harness.container.querySelector('[data-testid="update-bell"]');
      expect(bellBtn, "UpdateBell button should render").not.toBeNull();

      // Wait for SSE handshake.
      await waitFor(
        () => serverHandle.clients.length,
        (n) => n === 1,
        { timeoutMs: 4_000 },
      );
      // The hook passes the slug in the `?skills=` filter.
      expect(serverHandle.clients[0]!.skills).toContain(SLUG_ID);

      await waitFor(
        () => harness.hook().status,
        (s) => s === "connected",
        { timeoutMs: 4_000, flush: harness.flush },
      );

      // No updates before emit.
      expect(harness.hook().pushUpdateCount).toBe(0);

      // Emit an event with both UUID and slug — mirrors the augmented event
      // the platform publish route forwards to the DO (FR-005).
      const evt = makeSlugEvent("2.0.0");
      serverHandle.emit(evt);

      // The hook should ingest the frame because the server delivered it;
      // the hook's own dedup/matching layer uses skillId for its store key
      // (the platform server already did the filter-matching before delivery).
      await waitFor(
        () => harness.hook().pushUpdateCount,
        (n) => n === 1,
        { timeoutMs: 4_000, flush: harness.flush },
      );

      const finalHook = harness.hook();
      expect(finalHook.pushUpdateCount).toBe(1);

      // The store key is the UUID (skillId) — the hook indexes by skillId.
      expect(finalHook.updatesById.has(UUID_ID)).toBe(true);
      const entry = finalHook.updatesById.get(UUID_ID);
      expect(entry?.version).toBe("2.0.0");
      expect(entry?.eventId).toBe(evt.eventId);
      expect(entry?.diffSummary).toBe("slug-subscriber dual-accept test");

      // Shared updateStore must hold the same entry.
      const snap = updateStore.getSnapshot();
      expect(snap.has(UUID_ID)).toBe(true);
      expect(snap.get(UUID_ID)?.version).toBe("2.0.0");
    } finally {
      await harness.unmount();
    }
  }, 15_000);
});
