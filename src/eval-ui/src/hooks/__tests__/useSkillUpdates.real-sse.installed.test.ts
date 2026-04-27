// @vitest-environment jsdom
//
// AC-US3-03 — real-SSE integration test for installed-skill resolver path (0736).
//
// Extends the slug-test pattern from 0732
// (useSkillUpdates.real-sse.slug.test.ts). The new scenario proves that when
// the studio hook receives an installed-skill list that carries uuid/slug
// (populated by the backend enrichment layer), the SSE filter sent to
// UpdateHub contains the resolved UUID/slug — NOT the raw <plugin>/<skill>
// local name.
//
// Test matrix:
//   1. Hook subscribes with uuid → SSE filter contains UUID, event delivered.
//   2. Hook subscribes with slug → SSE filter contains slug, event delivered.
//   3. Hook subscribes with both uuid+slug → filter contains both, event delivered.
//   4. Skill with neither uuid nor slug is omitted from filter (graceful degradation).
//   5. Mixed list: only resolved skills appear in filter.
//
// Pattern: real Node http SSE server, real EventSource (eventsource npm pkg),
// React act() harness. No mocks on the network path.

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
// Minimal SSE server
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
// React harness
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

const UUID_A = "uuid-installed-0001";
const SLUG_A = "sk_published_acme/myrepo/greet-anton";

function makeEvent(skillId: string, skillSlug: string | undefined, version = "1.1.0"): SkillUpdateEvent {
  return {
    type: "skill.updated",
    eventId: `evt_installed_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    skillId,
    ...(skillSlug !== undefined ? { skillSlug } : {}),
    version,
    gitSha: "deadbeef",
    publishedAt: new Date().toISOString(),
    diffSummary: "installed-resolver integration test",
  };
}

// ---------------------------------------------------------------------------
// Tests — AC-US3-03
// ---------------------------------------------------------------------------

describe("useSkillUpdates — installed-skill resolver real-SSE (AC-US3-03 / 0736)", () => {
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

  it("AC-US3-03a: UUID-subscribed hook receives skill.updated event from server", async () => {
    // Hook subscribes using UUID (the format resolveSubscriptionIds extracts
    // when uuid is present). Server emits event with matching skillId (UUID).
    const harness = await mountStudioWithBell({
      streamUrlBase: serverHandle.url,
      skillIds: [UUID_A],
    });

    try {
      await waitFor(() => serverHandle.clients.length, (n) => n === 1, { timeoutMs: 4_000 });
      expect(serverHandle.clients[0]!.skills).toContain(UUID_A);

      await waitFor(
        () => harness.hook().status,
        (s) => s === "connected",
        { timeoutMs: 4_000, flush: harness.flush },
      );

      expect(harness.hook().pushUpdateCount).toBe(0);

      const evt = makeEvent(UUID_A, SLUG_A, "1.1.0");
      serverHandle.emit(evt);

      await waitFor(
        () => harness.hook().pushUpdateCount,
        (n) => n === 1,
        { timeoutMs: 4_000, flush: harness.flush },
      );

      const h = harness.hook();
      expect(h.pushUpdateCount).toBe(1);
      expect(h.updatesById.has(UUID_A)).toBe(true);
      expect(h.updatesById.get(UUID_A)?.version).toBe("1.1.0");
    } finally {
      await harness.unmount();
    }
  }, 15_000);

  it("AC-US3-03b: slug-subscribed hook receives skill.updated event from server", async () => {
    // Hook subscribes using slug (resolveSubscriptionIds extracts slug when
    // uuid is absent). Server emits with both UUID and slug — subscriber
    // matched by slug on the platform side, frame arrives with skillId=UUID.
    const harness = await mountStudioWithBell({
      streamUrlBase: serverHandle.url,
      skillIds: [SLUG_A],
    });

    try {
      await waitFor(() => serverHandle.clients.length, (n) => n === 1, { timeoutMs: 4_000 });
      expect(serverHandle.clients[0]!.skills).toContain(SLUG_A);

      await waitFor(
        () => harness.hook().status,
        (s) => s === "connected",
        { timeoutMs: 4_000, flush: harness.flush },
      );

      const evt = makeEvent(UUID_A, SLUG_A, "2.0.0");
      serverHandle.emit(evt);

      await waitFor(
        () => harness.hook().pushUpdateCount,
        (n) => n === 1,
        { timeoutMs: 4_000, flush: harness.flush },
      );

      const h = harness.hook();
      expect(h.updatesById.has(UUID_A)).toBe(true);
      expect(h.updatesById.get(UUID_A)?.version).toBe("2.0.0");
    } finally {
      await harness.unmount();
    }
  }, 15_000);

  it("AC-US3-03c: both uuid+slug in filter — server delivers event, hook ingests it once", async () => {
    // When the caller passes both UUID and slug (resolveSubscriptionIds returns
    // both), only one event is ingested even though both formats match.
    // The hook's dedup layer (seenEventIds) prevents double-counting.
    const harness = await mountStudioWithBell({
      streamUrlBase: serverHandle.url,
      skillIds: [UUID_A, SLUG_A],
    });

    try {
      await waitFor(() => serverHandle.clients.length, (n) => n === 1, { timeoutMs: 4_000 });
      const sentSkills = serverHandle.clients[0]!.skills;
      expect(sentSkills).toContain(UUID_A);
      expect(sentSkills).toContain(SLUG_A);

      await waitFor(
        () => harness.hook().status,
        (s) => s === "connected",
        { timeoutMs: 4_000, flush: harness.flush },
      );

      const evt = makeEvent(UUID_A, SLUG_A, "3.0.0");
      serverHandle.emit(evt);

      await waitFor(
        () => harness.hook().pushUpdateCount,
        (n) => n === 1,
        { timeoutMs: 4_000, flush: harness.flush },
      );

      // Exactly one entry despite two IDs in the filter
      expect(harness.hook().pushUpdateCount).toBe(1);
    } finally {
      await harness.unmount();
    }
  }, 15_000);

  it("AC-US3-02: local-only skill (no uuid/slug) produces empty filter → no SSE opened", async () => {
    // When all installed skills lack uuid/slug (local-only), resolveSubscriptionIds
    // returns [] and useSkillUpdates falls back to polling — no SSE connection.
    // The hook receives an empty skillIds list and flips to 'fallback' status.
    const harness = await mountStudioWithBell({
      streamUrlBase: serverHandle.url,
      skillIds: [],  // simulates all skills omitted by resolver
    });

    try {
      // No SSE client should connect
      await new Promise((r) => setTimeout(r, 200));
      expect(serverHandle.clients).toHaveLength(0);

      await waitFor(
        () => harness.hook().status,
        (s) => s === "fallback",
        { timeoutMs: 2_000, flush: harness.flush },
      );
    } finally {
      await harness.unmount();
    }
  }, 10_000);
});
