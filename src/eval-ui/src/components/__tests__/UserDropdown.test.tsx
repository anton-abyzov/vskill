// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 0831 T-011 — UserDropdown component tests.
//
// We mock useDesktopBridge to avoid pulling in the real Tauri internals.
// Each test rebinds the bridge stub before mounting so we can drive the
// component through its three render states (browser-mode, signed-out,
// signed-in) and the device-flow lifecycle (start → poll-pending → poll-
// granted).

import type {
  DesktopBridge,
  DeviceFlowStartResponse,
  PollGithubDeviceFlowOutcome,
  SignedInUser,
} from "../../preferences/lib/useDesktopBridge";

interface BridgeStub {
  bridge: Partial<DesktopBridge>;
}

const bridgeStub: BridgeStub = {
  // Defaults overridden in each test's `beforeEach`. The factory below
  // returns whatever `bridgeStub.bridge` is at the time of the hook call,
  // so reassigning `bridgeStub.bridge` between mounts swaps the bridge.
  bridge: { available: false, mode: "browser" },
};

vi.mock("../../preferences/lib/useDesktopBridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../preferences/lib/useDesktopBridge")>();
  return {
    ...actual,
    useDesktopBridge: () => bridgeStub.bridge as DesktopBridge,
  };
});

async function mount() {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { UserDropdown } = await import("../UserDropdown");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(UserDropdown));
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

async function flushMicrotasks() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

const SAMPLE_USER: SignedInUser = {
  login: "octocat",
  avatar_url: "https://example.test/avatar.png",
  email: null,
  cached_at: "2026-05-07T12:00:00Z",
};

const SAMPLE_FLOW: DeviceFlowStartResponse = {
  userCode: "WDJB-MJHT",
  verificationUri: "https://github.com/login/device",
  interval: 1,
  expiresIn: 900,
};

describe("UserDropdown (0831 T-011)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("AC-US1-01: renders nothing in browser mode", async () => {
    bridgeStub.bridge = {
      available: false,
      mode: "browser",
      getSignedInUser: vi.fn().mockResolvedValue(null),
    } as Partial<DesktopBridge>;
    const h = await mount();
    try {
      // Browser mode short-circuits to `null`. The cold-start placeholder
      // only renders for desktop mode; in browser we render literally
      // nothing so the top-rail layout doesn't reserve space.
      expect(h.container.querySelector("[data-slot='user-dropdown']")).toBeFalsy();
      expect(h.container.querySelector("[data-slot='user-dropdown-placeholder']")).toBeFalsy();
    } finally {
      h.unmount();
    }
  });

  it("AC-US1-01: signed-out desktop renders 'Sign in' button", async () => {
    bridgeStub.bridge = {
      available: true,
      mode: "desktop",
      getSignedInUser: vi.fn().mockResolvedValue(null),
      startGithubDeviceFlow: vi.fn(),
      pollGithubDeviceFlow: vi.fn(),
      signOut: vi.fn(),
    } as Partial<DesktopBridge>;
    const h = await mount();
    try {
      // Cold-start identity load is async — flush microtasks to let the
      // useEffect resolve before assertions. Without this we'd assert on
      // the placeholder render.
      await h.act(async () => { await flushMicrotasks(); });
      const btn = h.container.querySelector("[data-slot='sign-in-button']");
      expect(btn).toBeTruthy();
      expect((btn as HTMLButtonElement).getAttribute("aria-label")).toBe("Sign in with GitHub");
    } finally {
      h.unmount();
    }
  });

  it("AC-US1-01 / AC-US1-02: clicking 'Sign in' shows the user_code dialog", async () => {
    const startSpy = vi.fn().mockResolvedValue(SAMPLE_FLOW);
    // Polling stays "pending" forever in this test — we only verify the
    // dialog appears with the right code. The granted path is its own
    // test below.
    const pollSpy = vi.fn(
      async (): Promise<PollGithubDeviceFlowOutcome> => ({ status: "pending" }),
    );
    bridgeStub.bridge = {
      available: true,
      mode: "desktop",
      getSignedInUser: vi.fn().mockResolvedValue(null),
      startGithubDeviceFlow: startSpy,
      pollGithubDeviceFlow: pollSpy,
      signOut: vi.fn(),
    } as Partial<DesktopBridge>;
    const h = await mount();
    try {
      await h.act(async () => { await flushMicrotasks(); });
      const btn = h.container.querySelector("[data-slot='sign-in-button']") as HTMLButtonElement;
      await h.act(async () => { btn.click(); await flushMicrotasks(); });
      // After the start IPC resolves, the dialog renders the user_code in
      // a <code aria-label="Authorization code"> element.
      const dialog = h.container.querySelector("[data-slot='sign-in-dialog']");
      expect(dialog).toBeTruthy();
      const code = dialog?.querySelector("code[aria-label='Authorization code']");
      expect(code?.textContent).toBe("WDJB-MJHT");
      expect(startSpy).toHaveBeenCalledTimes(1);
    } finally {
      h.unmount();
    }
  });

  it("AC-US1-04 / AC-US1-05: poll outcome 'granted' clears dialog and shows user chip", async () => {
    const pollSpy = vi.fn(
      async (): Promise<PollGithubDeviceFlowOutcome> => ({ status: "granted", user: SAMPLE_USER }),
    );
    bridgeStub.bridge = {
      available: true,
      mode: "desktop",
      getSignedInUser: vi.fn().mockResolvedValue(null),
      startGithubDeviceFlow: vi.fn().mockResolvedValue(SAMPLE_FLOW),
      pollGithubDeviceFlow: pollSpy,
      signOut: vi.fn(),
    } as Partial<DesktopBridge>;
    const h = await mount();
    try {
      await h.act(async () => { await flushMicrotasks(); });
      const btn = h.container.querySelector("[data-slot='sign-in-button']") as HTMLButtonElement;
      await h.act(async () => { btn.click(); await flushMicrotasks(); });
      // Advance fake timers past the first poll interval (SAMPLE_FLOW.interval = 1s).
      // Use a generous bump to clear any internal 250ms tick budget — the
      // sleep helper polls the abort flag every 250ms so we need ≥1s of
      // virtual time to roll past the interval.
      await h.act(async () => {
        vi.advanceTimersByTime(2000);
        await flushMicrotasks();
        await flushMicrotasks();
      });
      // After granted, dialog should be gone and the user chip rendered.
      expect(h.container.querySelector("[data-slot='sign-in-dialog']")).toBeFalsy();
      const chip = h.container.querySelector("[data-slot='user-chip']");
      expect(chip).toBeTruthy();
      expect(chip?.textContent).toContain("octocat");
    } finally {
      h.unmount();
    }
  });

  it("AC-US2-01: signed-in renders avatar + login chip with menu trigger", async () => {
    bridgeStub.bridge = {
      available: true,
      mode: "desktop",
      getSignedInUser: vi.fn().mockResolvedValue(SAMPLE_USER),
      startGithubDeviceFlow: vi.fn(),
      pollGithubDeviceFlow: vi.fn(),
      signOut: vi.fn(),
    } as Partial<DesktopBridge>;
    const h = await mount();
    try {
      await h.act(async () => { await flushMicrotasks(); });
      const chip = h.container.querySelector("[data-slot='user-chip']") as HTMLButtonElement;
      expect(chip).toBeTruthy();
      expect(chip.getAttribute("aria-haspopup")).toBe("menu");
      expect(chip.getAttribute("aria-expanded")).toBe("false");
      // Click reveals the menu.
      await h.act(async () => { chip.click(); await flushMicrotasks(); });
      const menu = h.container.querySelector("[data-slot='user-menu']");
      expect(menu).toBeTruthy();
      // Menu must include "Sign out" (AC-US2-01).
      const items = Array.from(menu?.querySelectorAll("[role='menuitem']") ?? []) as HTMLElement[];
      const labels = items.map((el) => el.textContent ?? "");
      expect(labels).toContain("Sign out");
      expect(labels).toContain("View on GitHub");
    } finally {
      h.unmount();
    }
  });

  it("AC-US2-01: clicking 'Sign out' calls bridge.signOut and reverts to signed-out", async () => {
    const signOutSpy = vi.fn().mockResolvedValue(undefined);
    bridgeStub.bridge = {
      available: true,
      mode: "desktop",
      getSignedInUser: vi.fn().mockResolvedValue(SAMPLE_USER),
      startGithubDeviceFlow: vi.fn(),
      pollGithubDeviceFlow: vi.fn(),
      signOut: signOutSpy,
    } as Partial<DesktopBridge>;
    const h = await mount();
    try {
      await h.act(async () => { await flushMicrotasks(); });
      const chip = h.container.querySelector("[data-slot='user-chip']") as HTMLButtonElement;
      await h.act(async () => { chip.click(); await flushMicrotasks(); });
      const menu = h.container.querySelector("[data-slot='user-menu']") as HTMLElement;
      const signOutItem = Array.from(menu.querySelectorAll("[role='menuitem']")).find(
        (el) => el.textContent === "Sign out",
      ) as HTMLButtonElement;
      expect(signOutItem).toBeTruthy();
      await h.act(async () => { signOutItem.click(); await flushMicrotasks(); });
      expect(signOutSpy).toHaveBeenCalledTimes(1);
      // After sign-out the chip vanishes and the sign-in button reappears.
      expect(h.container.querySelector("[data-slot='user-chip']")).toBeFalsy();
      expect(h.container.querySelector("[data-slot='sign-in-button']")).toBeTruthy();
    } finally {
      h.unmount();
    }
  });

  it("AC-US1-06: poll outcome 'denied' surfaces error in the dialog", async () => {
    const pollSpy = vi.fn(
      async (): Promise<PollGithubDeviceFlowOutcome> => ({ status: "denied" }),
    );
    bridgeStub.bridge = {
      available: true,
      mode: "desktop",
      getSignedInUser: vi.fn().mockResolvedValue(null),
      startGithubDeviceFlow: vi.fn().mockResolvedValue(SAMPLE_FLOW),
      pollGithubDeviceFlow: pollSpy,
      signOut: vi.fn(),
    } as Partial<DesktopBridge>;
    const h = await mount();
    try {
      await h.act(async () => { await flushMicrotasks(); });
      const btn = h.container.querySelector("[data-slot='sign-in-button']") as HTMLButtonElement;
      await h.act(async () => { btn.click(); await flushMicrotasks(); });
      await h.act(async () => {
        vi.advanceTimersByTime(2000);
        await flushMicrotasks();
        await flushMicrotasks();
      });
      const alert = h.container.querySelector("[role='alert']");
      expect(alert?.textContent).toMatch(/denied/i);
    } finally {
      h.unmount();
    }
  });
});
