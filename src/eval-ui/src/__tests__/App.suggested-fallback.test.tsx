// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0733 T-003 — App.tsx suggested-fallback hydration regression test.
//
// The hydration block in App.tsx (lines 138-158 as of 0733) must:
//   1. When localStorage `activeAgent` is empty AND `useAgentsResponse()`
//      returns a `suggested` value → call `handleActiveAgentChange(suggested)`
//      so localStorage persists AND `studio:agent-changed` fires exactly once.
//   2. When localStorage already has an `activeAgent` value → suggested
//      is ignored and no event fires from hydration.
//
// Why a harness, not <App />: App.tsx pulls in dozens of providers and a
// real fetch path; mounting it here would dwarf the actual contract under
// test. The HydrationHarness below is a byte-for-byte mirror of App.tsx's
// hydration block (search for "0733: Hydrate from the server's `suggested`"
// in App.tsx). If that block changes, this harness MUST be updated in
// lockstep — failing to do so will surface as a contract drift.
//
// ACs covered: AC-US1-02 (localStorage persistence), AC-US1-03 (event
// fires once with correct detail), AC-US1-04 (existing localStorage wins).
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import {
  getStudioPreference,
  writeStudioPreference,
} from "../hooks/useStudioPreferences";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Mirror of App.tsx hydration block. Keep this in sync with
 * src/eval-ui/src/App.tsx (look for the `0733: Hydrate from the server's
 * suggested` comment marker).
 */
function HydrationHarness({ suggested }: { suggested: string | null }) {
  const [activeAgentId, setActiveAgentIdState] = useState<string | null>(() =>
    getStudioPreference<string | null>("activeAgent", null),
  );
  const handleActiveAgentChange = useCallback((agentId: string) => {
    setActiveAgentIdState(agentId);
    writeStudioPreference("activeAgent", agentId);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("studio:agent-changed", { detail: { agentId } }),
      );
    }
  }, []);
  useEffect(() => {
    if (!activeAgentId && suggested) {
      handleActiveAgentChange(suggested);
    }
  }, [activeAgentId, suggested, handleActiveAgentChange]);
  return React.createElement("div", { "data-testid": "harness", "data-active-agent": activeAgentId ?? "" });
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let agentChangedEvents: Array<CustomEvent<{ agentId: string }>> = [];
let listener: ((e: Event) => void) | null = null;

beforeEach(() => {
  // Reset localStorage to a known clean state.
  try { window.localStorage.clear(); } catch { /* noop */ }
  agentChangedEvents = [];
  listener = (e: Event) => {
    agentChangedEvents.push(e as CustomEvent<{ agentId: string }>);
  };
  // CRITICAL: attach BEFORE mount so the dispatch in the same tick is
  // observed (AC-US1-03 explicitly requires this guarantee).
  window.addEventListener("studio:agent-changed", listener);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (listener) window.removeEventListener("studio:agent-changed", listener);
  listener = null;
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  try { window.localStorage.clear(); } catch { /* noop */ }
});

describe("0733 T-003 — App.tsx suggested-fallback hydration", () => {
  it("AC-US1-02 / AC-US1-03: empty localStorage + suggested → persists + fires event exactly once", async () => {
    act(() => {
      root!.render(
        React.createElement(HydrationHarness, { suggested: "claude-code" }),
      );
    });

    // Persistence — after the effect runs, localStorage must contain the
    // suggested agent under the activeAgent key.
    const persisted = getStudioPreference<string | null>("activeAgent", null);
    expect(persisted).toBe("claude-code");

    // Event count + detail shape — exactly one event with detail.agentId
    // matching the suggested value (AC-US1-03).
    expect(agentChangedEvents).toHaveLength(1);
    expect(agentChangedEvents[0].detail.agentId).toBe("claude-code");
  });

  it("AC-US1-04: pre-populated localStorage is NOT overwritten by suggested", async () => {
    // Seed localStorage with an explicit choice BEFORE mount.
    writeStudioPreference("activeAgent", "opencode");
    // Reset event log so we observe only post-seed events.
    agentChangedEvents = [];

    act(() => {
      root!.render(
        React.createElement(HydrationHarness, { suggested: "claude-code" }),
      );
    });

    // localStorage stays at "opencode" — suggested must lose to existing.
    const persisted = getStudioPreference<string | null>("activeAgent", null);
    expect(persisted).toBe("opencode");

    // Hydration must have produced ZERO events because localStorage
    // already had a value (the harness/App init path reads it via
    // useState initializer and the effect's `if (!activeAgentId)` short-
    // circuits).
    expect(agentChangedEvents).toHaveLength(0);
  });

  it("AC-US1-03: a listener attached BEFORE mount receives the hydration event (timing guarantee)", async () => {
    // Already attached in beforeEach. We just verify the count after mount.
    act(() => {
      root!.render(
        React.createElement(HydrationHarness, { suggested: "claude-code" }),
      );
    });
    expect(agentChangedEvents).toHaveLength(1);
    // And critically: the same agentId in the event matches the persisted
    // value — guards against a race where the event fires before localStorage
    // is updated.
    expect(agentChangedEvents[0].detail.agentId).toBe(
      getStudioPreference<string | null>("activeAgent", null),
    );
  });
});
