// @vitest-environment jsdom
// 1126 AC-02 / AC-03: pin toggle in the skill detail, and "Push to all
// machines" only when the SpecWithCode CLI is on this machine.
import { beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({
  getSkillPinState: vi.fn(),
  getFleetStatus: vi.fn(),
  getSkillVersions: vi.fn(),
  pinSkill: vi.fn(),
  unpinSkill: vi.fn(),
  pushSkillToFleet: vi.fn(),
}));
vi.mock("../../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api")>();
  return { ...actual, api: { ...actual.api, ...m } };
});

const skill = {
  plugin: "repo",
  skill: "alpha",
  dir: "/x",
  origin: "installed",
  scopeV2: "available-personal",
} as unknown as import("../../types").SkillInfo;

async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

async function mount() {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { SkillVersionControls } = await import("../SkillVersionControls");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(React.createElement(SkillVersionControls, { skill })); });
  await act(async () => { await flush(); });
  const click = async (sel: string) => {
    await act(async () => { (container.querySelector(sel) as HTMLElement).click(); await flush(); });
  };
  return { container, click, unmount: () => { act(() => root.unmount()); container.remove(); } };
}

const pinState = { found: true, lockName: "alpha", fullName: "owner/repo/alpha", scope: "global", installedVersion: "1.2.0", pinned: false, pinnedVersion: null, canInstallVersion: true };

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.getSkillVersions.mockResolvedValue([{ version: "1.2.0" }, { version: "1.1.0" }]);
});

describe("SkillVersionControls", () => {
  it("hides Push to all machines when specweave-studio is absent, and pins", async () => {
    m.getSkillPinState.mockResolvedValue(pinState);
    m.getFleetStatus.mockResolvedValue({ available: false, skillsSupported: false, machines: null });
    m.pinSkill.mockResolvedValue({ ...pinState, pinned: true, pinnedVersion: "1.2.0" });
    const h = await mount();
    try {
      expect(h.container.querySelector("[data-testid='skill-push-fleet']")).toBeNull();
      expect(h.container.textContent).toContain("Installed 1.2.0");
      await h.click("[data-testid='skill-pin-toggle']");
      expect(m.pinSkill).toHaveBeenCalledWith("repo", "alpha");
      expect(h.container.textContent).toContain("pinned at 1.2.0");
      expect(h.container.querySelector("[data-testid='skill-pin-toggle']")?.textContent).toBe("Unpin");
    } finally {
      h.unmount();
    }
  });

  it("pushes the selected version and lists each machine's result", async () => {
    m.getSkillPinState.mockResolvedValue(pinState);
    m.getFleetStatus.mockResolvedValue({ available: true, skillsSupported: true, machines: null });
    m.pushSkillToFleet.mockResolvedValue({
      ok: false,
      error: "Some machines did not install it.",
      results: [
        { machine: "m1", ok: true, installedVersion: "1.2.0" },
        { machine: "m3", ok: false, reason: "vskill-missing" },
      ],
    });
    const h = await mount();
    try {
      const sel = h.container.querySelector("[data-testid='skill-push-fleet-version']") as HTMLSelectElement;
      expect(Array.from(sel.options).map((o) => o.value)).toEqual(["1.2.0", "1.1.0"]);
      await h.click("[data-testid='skill-push-fleet-button']");
      expect(m.pushSkillToFleet).toHaveBeenCalledWith("repo", "alpha", "1.2.0", true, "owner/repo/alpha");
      const results = h.container.querySelector("[data-testid='skill-push-fleet-results']")?.textContent ?? "";
      expect(results).toContain("m1: installed 1.2.0");
      expect(results).toContain("m3: vskill-missing");
    } finally {
      h.unmount();
    }
  });

  it("shows the not-available message from the server", async () => {
    m.getSkillPinState.mockResolvedValue(pinState);
    m.getFleetStatus.mockResolvedValue({ available: true, skillsSupported: false, machines: null });
    m.pushSkillToFleet.mockResolvedValue({ ok: false, notAvailable: true, error: "fleet skills is not available on this SpecWithCode yet." });
    const h = await mount();
    try {
      await h.click("[data-testid='skill-push-fleet-button']");
      expect(h.container.querySelector("[data-testid='skill-push-fleet-error']")?.textContent).toContain("not available on this SpecWithCode yet");
    } finally {
      h.unmount();
    }
  });

  it("renders nothing for skills without a lock entry", async () => {
    m.getSkillPinState.mockResolvedValue({ found: false });
    m.getFleetStatus.mockResolvedValue({ available: true, skillsSupported: true, machines: null });
    const h = await mount();
    try {
      expect(h.container.querySelector("[data-testid='skill-version-controls']")).toBeNull();
    } finally {
      h.unmount();
    }
  });
});
