// ---------------------------------------------------------------------------
// 0792 T-010: RunDispatcherPanel — wrapper that picks one of three modes.
//
// Verifies the wrapper dispatches to the correct existing panel without
// touching panel internals (per AC-US1-05).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";

vi.mock("../RunPanel", () => ({ RunPanel: () => null }));
vi.mock("../ActivationPanel", () => ({ ActivationPanel: () => null }));

// 0800: RunDispatcherPanel now reads WorkspaceContext for the autorun effect.
// Stub it so the function-call render still works without a provider.
vi.mock("../WorkspaceContext", () => ({
  useWorkspace: () => ({
    state: { evals: null, plugin: "p", skill: "s" },
    runAll: vi.fn(),
  }),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: () => {},
    useRef: (init: unknown) => ({ current: init }),
  };
});

import {
  RunDispatcherPanel,
  RUN_MODES,
  isValidRunMode,
} from "../RunDispatcherPanel";
import { RunPanel } from "../RunPanel";
import { ActivationPanel } from "../ActivationPanel";

type ReactEl = { type: unknown; props: Record<string, unknown> };

describe("RunDispatcherPanel (0792 T-010)", () => {
  it("renders RunPanel for benchmark mode", () => {
    const tree = RunDispatcherPanel({ mode: "benchmark" }) as ReactEl;
    expect(tree.type).toBe(RunPanel);
  });

  it("renders RunPanel for ab mode (A/B comparison lives inside RunPanel)", () => {
    const tree = RunDispatcherPanel({ mode: "ab" }) as ReactEl;
    expect(tree.type).toBe(RunPanel);
  });

  it("renders ActivationPanel for activation mode", () => {
    const tree = RunDispatcherPanel({ mode: "activation" }) as ReactEl;
    expect(tree.type).toBe(ActivationPanel);
  });

  it("exposes RUN_MODES with three modes in stable order", () => {
    expect(RUN_MODES.map((m) => m.id)).toEqual(["benchmark", "activation", "ab"]);
  });

  it("validates run modes via isValidRunMode", () => {
    expect(isValidRunMode("benchmark")).toBe(true);
    expect(isValidRunMode("activation")).toBe(true);
    expect(isValidRunMode("ab")).toBe(true);
    expect(isValidRunMode("history")).toBe(false);
    expect(isValidRunMode("")).toBe(false);
    expect(isValidRunMode(null)).toBe(false);
    expect(isValidRunMode(undefined)).toBe(false);
  });
});
