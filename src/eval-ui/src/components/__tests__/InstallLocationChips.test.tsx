// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0747 T-008: InstallLocationChips renders a chip strip below skill detail
// title showing every install location with optional pinned 📌 / readonly 🔒
// indicators. Per-chip "Update this location" button is shown only for
// non-readonly, non-pinned chips. N==1 → renders nothing.
// ---------------------------------------------------------------------------
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstallLocation } from "../../api";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const proj: InstallLocation = {
  scope: "project",
  agent: "claude-code",
  agentLabel: "Claude Code",
  dir: "/p/.claude/skills/foo",
  symlinked: false,
  readonly: false,
};
const personal: InstallLocation = {
  scope: "personal",
  agent: "claude-code",
  agentLabel: "Claude Code",
  dir: "/h/.claude/skills/foo",
  symlinked: false,
  readonly: false,
};
const codex: InstallLocation = {
  scope: "personal",
  agent: "codex",
  agentLabel: "Codex CLI",
  dir: "/h/.codex/skills/foo",
  symlinked: false,
  readonly: false,
};
const pluginRO: InstallLocation = {
  scope: "plugin",
  agent: "claude-code",
  agentLabel: "Claude Code",
  dir: "/h/.claude/plugins/cache/m/mobile/1.0/skills/foo",
  pluginSlug: "mobile",
  symlinked: false,
  readonly: true,
};

async function mountChips(props: {
  locations: InstallLocation[];
  pinned?: boolean;
  onChipClick?: (l: InstallLocation) => void;
  onUpdateLocation?: (l: InstallLocation) => void;
}) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const InstallLocationChips = (await import("../InstallLocationChips")).InstallLocationChips;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(InstallLocationChips, props));
  });
  return {
    container,
    act: (fn: () => void | Promise<void>) => act(async () => { await fn(); }),
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("InstallLocationChips (0747 T-008)", () => {
  it("TC-001: renders nothing when N==1 (avoid clutter for the common case)", async () => {
    const h = await mountChips({ locations: [proj] });
    try {
      const chips = h.container.querySelectorAll("[data-testid='install-location-chip']");
      expect(chips.length).toBe(0);
    } finally {
      h.unmount();
    }
  });

  it("TC-002: renders one chip per location with scope · agentLabel text", async () => {
    const h = await mountChips({ locations: [proj, personal, codex] });
    try {
      const chips = Array.from(
        h.container.querySelectorAll("[data-testid='install-location-chip']"),
      );
      expect(chips.length).toBe(3);
      const txt = chips.map((c) => c.textContent ?? "");
      expect(txt.some((t) => t.includes("project") && t.includes("Claude Code"))).toBe(true);
      expect(txt.some((t) => t.includes("personal") && t.includes("Codex CLI"))).toBe(true);
    } finally {
      h.unmount();
    }
  });

  it("TC-003: readonly (plugin-bundled) chip shows 🔒 and has no Update affordance", async () => {
    const h = await mountChips({ locations: [proj, pluginRO] });
    try {
      const ro = Array.from(
        h.container.querySelectorAll("[data-testid='install-location-chip']"),
      ).find((c) => (c.textContent ?? "").includes("plugin"));
      expect(ro?.textContent ?? "").toContain("🔒");
      const roUpdateBtn = ro?.querySelector(
        "[data-testid='install-location-chip-update']",
      );
      expect(roUpdateBtn).toBeFalsy();
    } finally {
      h.unmount();
    }
  });

  it("TC-004: pinned chips show 📌", async () => {
    const h = await mountChips({ locations: [proj, personal], pinned: true });
    try {
      const chips = Array.from(
        h.container.querySelectorAll("[data-testid='install-location-chip']"),
      );
      expect(chips.length).toBe(2);
      for (const c of chips) {
        expect(c.textContent ?? "").toContain("📌");
      }
    } finally {
      h.unmount();
    }
  });

  it("TC-005: clicking a chip calls onChipClick with the location", async () => {
    const onChipClick = vi.fn();
    const h = await mountChips({ locations: [proj, personal], onChipClick });
    try {
      const projChip = Array.from(
        h.container.querySelectorAll("[data-testid='install-location-chip']"),
      ).find((c) => (c.textContent ?? "").includes("project")) as HTMLElement;
      await h.act(async () => projChip.click());
      expect(onChipClick).toHaveBeenCalledTimes(1);
      expect(onChipClick.mock.calls[0][0]).toMatchObject({ scope: "project" });
    } finally {
      h.unmount();
    }
  });

  it("TC-006: clicking Update on a non-readonly, non-pinned chip calls onUpdateLocation", async () => {
    const onUpdateLocation = vi.fn();
    const h = await mountChips({ locations: [proj, personal], onUpdateLocation });
    try {
      const updateBtn = h.container.querySelector(
        "[data-testid='install-location-chip-update']",
      ) as HTMLButtonElement;
      expect(updateBtn).toBeTruthy();
      await h.act(async () => updateBtn.click());
      expect(onUpdateLocation).toHaveBeenCalledTimes(1);
    } finally {
      h.unmount();
    }
  });
});
