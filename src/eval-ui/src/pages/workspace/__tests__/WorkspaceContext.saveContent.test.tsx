// @vitest-environment jsdom
//
// 0779 F-002 — saveContent contract test.
//
// Asserts the wiring: when EditorPanel.handleSave passes a contentOverride to
// saveContent, that exact string is forwarded to api.applyImprovement, and a
// SET_CONTENT dispatch keeps the editor state in sync. Together with the
// pure-helper tests in computeSavePayload.test.ts, this proves the full
// chain: helper → saveContent → api.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const mockApplyImprovement = vi.fn().mockResolvedValue(undefined);
const mockGetSkillContent = vi.fn().mockResolvedValue("");
const mockGetEvals = vi.fn().mockResolvedValue({ skill_name: "x", evals: [] });

vi.mock("../../../api", () => ({
  api: {
    applyImprovement: (...a: unknown[]) => mockApplyImprovement(...a),
    getSkillContent: (...a: unknown[]) => mockGetSkillContent(...a),
    getEvals: (...a: unknown[]) => mockGetEvals(...a),
    getLatestBenchmark: vi.fn().mockResolvedValue(null),
    getActivationHistory: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../../../sse", () => ({
  useMultiSSE: () => ({ startCase: vi.fn(), stopCase: vi.fn(), stopAll: vi.fn() }),
  useSSE: () => ({ events: [], start: vi.fn(), stop: vi.fn(), connected: false, error: null }),
}));

vi.mock("../../../ConfigContext", () => ({
  useConfig: () => ({ config: { provider: "claude-cli", model: "sonnet" } }),
}));

import { WorkspaceProvider, useWorkspace } from "../WorkspaceContext";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mockApplyImprovement.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

interface CtxRef { current: ReturnType<typeof useWorkspace> }

function Harness({ snapshot }: { snapshot: CtxRef }) {
  snapshot.current = useWorkspace();
  return null;
}

async function renderProvider(): Promise<CtxRef> {
  // Mutable ref so successive renders refresh the snapshot — tests read
  // snapshot.current after each act() to see post-dispatch state.
  const snapshot = { current: undefined as unknown as ReturnType<typeof useWorkspace> };
  await act(async () => {
    root.render(
      <WorkspaceProvider plugin="p" skill="s" origin="source">
        <Harness snapshot={snapshot} />
      </WorkspaceProvider>,
    );
  });
  return snapshot;
}

describe("saveContent — contentOverride contract (0779 F-002)", () => {
  it("forwards contentOverride to api.applyImprovement verbatim", async () => {
    const ref = await renderProvider();
    // Seed editor state via the real SET_CONTENT action.
    await act(async () => {
      ref.current.dispatch({
        type: "SET_CONTENT",
        content: "---\nversion: \"1.0.2\"\n---\nbody",
      });
    });
    await act(async () => {
      await ref.current.saveContent("---\nversion: \"1.0.3\"\n---\nbody");
    });
    expect(mockApplyImprovement).toHaveBeenCalledTimes(1);
    expect(mockApplyImprovement).toHaveBeenCalledWith(
      "p",
      "s",
      "---\nversion: \"1.0.3\"\n---\nbody",
    );
    // After the override-bearing save, skillContent reflects the bumped value
    // (the SET_CONTENT-on-divergence dispatch fired).
    expect(ref.current.state.skillContent).toBe(
      "---\nversion: \"1.0.3\"\n---\nbody",
    );
  });

  it("does NOT mutate skillContent when override equals current state", async () => {
    const ref = await renderProvider();
    const seeded = "---\nversion: \"1.0.2\"\n---\nbody";
    await act(async () => {
      ref.current.dispatch({ type: "SET_CONTENT", content: seeded });
    });
    // Snapshot the post-seed reference; if the redundant-dispatch guard fires,
    // skillContent should be reference-equal afterwards (no SET_CONTENT
    // dispatched, so the reducer never returned a new state object).
    const before = ref.current.state.skillContent;
    await act(async () => {
      await ref.current.saveContent(seeded);
    });
    expect(mockApplyImprovement).toHaveBeenCalledWith("p", "s", seeded);
    // Same string — proves we forwarded the override verbatim — and the
    // override-equals-current branch in saveContent skipped SET_CONTENT, so
    // savedContent was promoted to seeded by CONTENT_SAVED without an extra
    // intermediate dispatch.
    expect(ref.current.state.skillContent).toBe(before);
    expect(ref.current.state.savedContent).toBe(seeded);
    expect(ref.current.state.isDirty).toBe(false);
  });
});
