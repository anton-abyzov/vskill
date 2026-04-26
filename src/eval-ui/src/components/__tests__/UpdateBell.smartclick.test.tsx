// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0747 T-006: UpdateBell smart click MUST call revealSkill (not selectSkill)
// using server-provided localPlugin/localSkill. Falls back to last-segment
// split when older server omits those fields. Surfaces a toast when the row
// matches no sidebar skill but installLocations names an owning agent.
// ---------------------------------------------------------------------------
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../assets/icons/update-bell.svg", () => ({ default: "stub-bell.svg" }));

interface CapturedDropdownProps {
  onSelectSkill?: (u: unknown) => void;
}
const dropdownProps: CapturedDropdownProps = {};
vi.mock("../UpdateDropdown", () => ({
  default: (props: { onSelectSkill: (u: unknown) => void; onClose: () => void }) => {
    dropdownProps.onSelectSkill = props.onSelectSkill;
    const React = require("react");
    return React.createElement(
      "button",
      {
        "data-testid": "fire-select",
        onClick: () => props.onSelectSkill(currentUpdate),
      },
      "fire",
    );
  },
}));

const toastMock = vi.fn();
vi.mock("../ToastProvider", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn(), clear: vi.fn() }),
}));

interface StubSkill {
  plugin: string;
  skill: string;
  origin: "source" | "installed";
  source?: string;
}
interface StudioStub {
  updateCount: number;
  updates: unknown[];
  isRefreshingUpdates: boolean;
  refreshUpdates: () => Promise<void>;
  selectSkill: (s: { plugin: string; skill: string; origin: string }) => void;
  revealSkill: (plugin: string, skillName: string) => void;
  skills?: StubSkill[];
  /** 0761 US-004: agent slug ("claude-code", "codex", …) so the bell can
   *  detect when the click target's installLocations include the current
   *  agent and use informational wording. */
  activeAgent?: string | null;
}

let stub: StudioStub;
let currentUpdate: Record<string, unknown>;

vi.mock("../../StudioContext", () => ({
  useStudio: () => stub,
}));

async function mountBell() {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { UpdateBell } = await import("../UpdateBell");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(UpdateBell));
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

beforeEach(() => {
  toastMock.mockReset();
  stub = {
    updateCount: 1,
    updates: [],
    isRefreshingUpdates: false,
    refreshUpdates: vi.fn(() => Promise.resolve()),
    selectSkill: vi.fn(),
    revealSkill: vi.fn(),
  };
  dropdownProps.onSelectSkill = undefined;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("UpdateBell smart click (0747 T-006)", () => {
  it("TC-001: when localPlugin/localSkill provided, calls revealSkill with that pair", async () => {
    currentUpdate = {
      name: "anton-abyzov/greet-anton/greet-anton",
      installed: "1.0.1",
      latest: "1.0.2",
      updateAvailable: true,
      localPlugin: "greet-anton",
      localSkill: "greet-anton",
      installLocations: [{
        scope: "personal",
        agent: "claude-code",
        agentLabel: "Claude Code",
        dir: "/h/.claude/skills/greet-anton",
        symlinked: false,
        readonly: false,
      }],
    };
    const h = await mountBell();
    try {
      // Open the dropdown
      const bell = h.container.querySelector("[data-testid='update-bell']") as HTMLButtonElement;
      await h.act(async () => bell.click());
      const fire = h.container.querySelector("[data-testid='fire-select']") as HTMLButtonElement;
      await h.act(async () => fire.click());
      expect(stub.revealSkill).toHaveBeenCalledWith("greet-anton", "greet-anton");
      expect(stub.selectSkill).not.toHaveBeenCalled();
    } finally {
      h.unmount();
    }
  });

  it("TC-002: when localPlugin/localSkill absent, falls back to last-segment split (backwards-compat)", async () => {
    currentUpdate = {
      name: "owner/repo/legacy-skill",
      installed: "1.0.0",
      latest: "1.0.1",
      updateAvailable: true,
      // no localPlugin / localSkill
    };
    const h = await mountBell();
    try {
      const bell = h.container.querySelector("[data-testid='update-bell']") as HTMLButtonElement;
      await h.act(async () => bell.click());
      const fire = h.container.querySelector("[data-testid='fire-select']") as HTMLButtonElement;
      await h.act(async () => fire.click());
      // Falls back to revealSkill with empty plugin + last-segment skill — revealSkill's
      // F-002 path then tries to match by skill alone among non-plugin sources.
      expect(stub.revealSkill).toHaveBeenCalledWith("", "legacy-skill");
    } finally {
      h.unmount();
    }
  });

  it("TC-003: shows a toast naming the owning agent when no match in current sidebar (revealSkill returns without selecting)", async () => {
    currentUpdate = {
      name: "owner/repo/foo",
      installed: "1",
      latest: "2",
      updateAvailable: true,
      localPlugin: "",
      localSkill: "foo",
      installLocations: [{
        scope: "personal",
        agent: "codex",
        agentLabel: "Codex CLI",
        dir: "/h/.codex/skills/foo",
        symlinked: false,
        readonly: false,
      }],
    };
    // revealSkill simulates the no-match case by being a no-op spy that does
    // not change state. The bell handler should detect no selection and toast.
    stub.revealSkill = vi.fn();
    stub.skills = []; // no matching row in state
    const h = await mountBell();
    try {
      const bell = h.container.querySelector("[data-testid='update-bell']") as HTMLButtonElement;
      await h.act(async () => bell.click());
      const fire = h.container.querySelector("[data-testid='fire-select']") as HTMLButtonElement;
      await h.act(async () => fire.click());
      expect(toastMock).toHaveBeenCalledTimes(1);
      const msg = (toastMock.mock.calls[0][0] as { message: string }).message;
      expect(msg).toContain("Codex CLI");
    } finally {
      h.unmount();
    }
  });

  // -------------------------------------------------------------------------
  // 0761 US-004: when the skill is ALSO installed under the current agent
  // (different plugin / different fs root than what the click target
  // resolved to), the toast must not say "switch to X" — the user is
  // already in a valid view.
  // -------------------------------------------------------------------------

  it("TC-004 (0761 AC-US4-01): installLocations includes current agent → 'Also installed under {other}' wording (no 'switch')", async () => {
    currentUpdate = {
      name: "anton-abyzov/greet-anton/greet-anton",
      installed: "1.0.1",
      latest: "1.0.2",
      updateAvailable: true,
      // Click target resolves to a plugin that doesn't appear under the
      // current agent's sidebar (matched=false), but the skill name DOES.
      localPlugin: "greet-anton",
      localSkill: "greet-anton",
      installLocations: [
        {
          scope: "personal",
          agent: "claude-code",
          agentLabel: "Claude Code",
          dir: "/h/.claude/skills/greet-anton",
          symlinked: false,
          readonly: false,
        },
        {
          scope: "personal",
          agent: "codex",
          agentLabel: "Codex CLI",
          dir: "/h/.codex/skills/greet-anton",
          symlinked: false,
          readonly: false,
        },
      ],
    };
    stub = { ...stub, activeAgent: "claude-code" } as StudioStub;
    stub.revealSkill = vi.fn();
    stub.skills = [
      {
        plugin: ".claude",
        skill: "greet-anton",
        origin: "installed",
      },
    ];

    const h = await mountBell();
    try {
      const bell = h.container.querySelector("[data-testid='update-bell']") as HTMLButtonElement;
      await h.act(async () => bell.click());
      const fire = h.container.querySelector("[data-testid='fire-select']") as HTMLButtonElement;
      await h.act(async () => fire.click());
      expect(toastMock).toHaveBeenCalledTimes(1);
      const msg = (toastMock.mock.calls[0][0] as { message: string }).message;
      expect(msg).toContain("Also installed under");
      expect(msg).toContain("Codex CLI");
      expect(msg).not.toContain("switch to");
    } finally {
      h.unmount();
    }
  });

  it("TC-005 (0761 AC-US4-02): installLocations does NOT include current agent → legacy 'switch to' wording preserved", async () => {
    currentUpdate = {
      name: "owner/repo/foo",
      installed: "1",
      latest: "2",
      updateAvailable: true,
      localPlugin: "owner-only",
      localSkill: "foo",
      installLocations: [
        {
          scope: "personal",
          agent: "codex",
          agentLabel: "Codex CLI",
          dir: "/h/.codex/skills/foo",
          symlinked: false,
          readonly: false,
        },
      ],
    };
    stub = { ...stub, activeAgent: "claude-code" } as StudioStub;
    stub.revealSkill = vi.fn();
    stub.skills = []; // current agent has no copy

    const h = await mountBell();
    try {
      const bell = h.container.querySelector("[data-testid='update-bell']") as HTMLButtonElement;
      await h.act(async () => bell.click());
      const fire = h.container.querySelector("[data-testid='fire-select']") as HTMLButtonElement;
      await h.act(async () => fire.click());
      expect(toastMock).toHaveBeenCalledTimes(1);
      const msg = (toastMock.mock.calls[0][0] as { message: string }).message;
      expect(msg).toContain("switch to");
      expect(msg).toContain("Codex CLI");
    } finally {
      h.unmount();
    }
  });
});
