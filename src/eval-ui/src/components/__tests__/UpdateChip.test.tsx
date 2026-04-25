// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { UpdateStoreEntry } from "../../types/skill-update";

interface StudioStub {
  updatesById: ReadonlyMap<string, UpdateStoreEntry>;
}

let stub: StudioStub = { updatesById: new Map() };

vi.mock("../../StudioContext", async () => {
  const React = await import("react");
  // A real React.Context whose current value we mutate via the _currentValue
  // slot that useContext reads from. Good enough for component-mount tests;
  // SkillRow's walker-based tests don't go through this mock at all.
  const ctx = React.createContext<StudioStub | null>(null);
  return {
    StudioContext: new Proxy(ctx, {
      get(target, prop, receiver) {
        if (prop === "_currentValue" || prop === "_currentValue2") return stub;
        return Reflect.get(target, prop, receiver);
      },
    }),
    useStudio: () => stub,
  };
});

async function mountChip(props: {
  skillId: string;
  trackedForUpdates: boolean;
}) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { UpdateChip } = await import("../UpdateChip");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(UpdateChip, props));
  });
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function makeEntry(partial: Partial<UpdateStoreEntry> = {}): UpdateStoreEntry {
  return {
    skillId: partial.skillId ?? "pdf",
    version: partial.version ?? "2.0.0",
    diffSummary: partial.diffSummary,
    eventId: partial.eventId ?? "evt-1",
    publishedAt: partial.publishedAt ?? new Date().toISOString(),
    receivedAt: partial.receivedAt ?? Date.now(),
  };
}

describe("UpdateChip (0708 T-037/T-038)", () => {
  beforeEach(() => {
    stub = { updatesById: new Map() };
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders blue update dot with version tooltip when skill has a push entry", async () => {
    stub = {
      updatesById: new Map([
        [
          "anthropic-skills/pdf",
          makeEntry({
            skillId: "anthropic-skills/pdf",
            version: "2.0.0",
            diffSummary: "adds annotations",
          }),
        ],
      ]),
    };
    const h = await mountChip({
      skillId: "anthropic-skills/pdf",
      trackedForUpdates: true,
    });
    try {
      const dot = h.container.querySelector("[data-testid='update-chip-update-dot']") as HTMLElement;
      expect(dot).toBeTruthy();
      expect(dot.getAttribute("aria-label")).toBe("Update available: 2.0.0");
      expect(dot.getAttribute("title")).toContain("2.0.0");
      expect(dot.getAttribute("title")).toContain("adds annotations");
      expect(
        h.container.querySelector("[data-testid='update-chip-untracked-dot']"),
      ).toBeNull();
    } finally {
      h.unmount();
    }
  });

  it("renders dim gray not-tracked dot when skill is not tracked on the server", async () => {
    const h = await mountChip({
      skillId: "legacy/skill",
      trackedForUpdates: false,
    });
    try {
      const dot = h.container.querySelector(
        "[data-testid='update-chip-untracked-dot']",
      ) as HTMLElement;
      expect(dot).toBeTruthy();
      expect(dot.getAttribute("aria-label")).toBe("Not tracked for updates");
      expect(dot.getAttribute("title")).toMatch(/vskill outdated/i);
      expect(
        h.container.querySelector("[data-testid='update-chip-update-dot']"),
      ).toBeNull();
    } finally {
      h.unmount();
    }
  });

  it("renders nothing when skill is tracked and has no pending update", async () => {
    const h = await mountChip({
      skillId: "anthropic-skills/pdf",
      trackedForUpdates: true,
    });
    try {
      expect(
        h.container.querySelector("[data-testid='update-chip-update-dot']"),
      ).toBeNull();
      expect(
        h.container.querySelector("[data-testid='update-chip-untracked-dot']"),
      ).toBeNull();
    } finally {
      h.unmount();
    }
  });

  it("update indicator takes precedence over not-tracked (no double-render)", async () => {
    stub = {
      updatesById: new Map([
        [
          "edge/skill",
          makeEntry({ skillId: "edge/skill", version: "1.0.1", diffSummary: "fix" }),
        ],
      ]),
    };
    const h = await mountChip({
      skillId: "edge/skill",
      trackedForUpdates: false,
    });
    try {
      expect(
        h.container.querySelector("[data-testid='update-chip-update-dot']"),
      ).toBeTruthy();
      expect(
        h.container.querySelector("[data-testid='update-chip-untracked-dot']"),
      ).toBeNull();
    } finally {
      h.unmount();
    }
  });
});
