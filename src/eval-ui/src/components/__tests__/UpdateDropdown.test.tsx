// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 0747 T-007: UpdateDropdown now consumes useToast for the inline Update
// button's success/error/blocked toasts. Tests that don't render
// <ToastProvider> must stub it.
vi.mock("../ToastProvider", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), clear: vi.fn() }),
}));

// 0766 F-002: UpdateDropdown now calls onSkillUpdated(plugin, skill) after
// a successful inline update so the bell + Versions tab clear together.
// Stub StudioContext so the dropdown can mount without the provider tree.
const onSkillUpdatedSpy = vi.fn();
vi.mock("../../StudioContext", () => ({
  useStudio: () => ({ onSkillUpdated: onSkillUpdatedSpy }),
}));

const majorMinor = [
  { name: "plugin-a/skill-x", installed: "1.0.0", latest: "2.0.0", updateAvailable: true },
  { name: "plugin-b/skill-y", installed: "1.0.0", latest: "1.1.0", updateAvailable: true },
];

async function mountDropdown(props: Partial<Parameters<
  typeof import("../UpdateDropdown").default
>[0]> = {}) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const UpdateDropdown = (await import("../UpdateDropdown")).default;

  const onRefresh = props.onRefresh ?? vi.fn();
  const onSelectSkill = props.onSelectSkill ?? vi.fn();
  const onViewAll = props.onViewAll ?? vi.fn();
  const onClose = props.onClose ?? vi.fn();

  const resolved = {
    updates: props.updates ?? majorMinor,
    isRefreshing: props.isRefreshing ?? false,
    onRefresh,
    onSelectSkill,
    onViewAll,
    onClose,
  };

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(UpdateDropdown, resolved));
  });
  return {
    container,
    handlers: { onRefresh, onSelectSkill, onViewAll, onClose },
    act: (fn: () => void | Promise<void>) => act(async () => { await fn(); }),
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("UpdateDropdown (0683 T-007)", () => {
  beforeEach(() => {
    window.location.hash = "";
  });
  afterEach(() => vi.clearAllMocks());

  it("renders one row per outdated skill with bump-type dot colors", async () => {
    const h = await mountDropdown();
    try {
      const rows = h.container.querySelectorAll("[data-testid='update-dropdown-row']");
      expect(rows).toHaveLength(2);
      const dots = h.container.querySelectorAll("[data-testid='update-dropdown-bump-dot']");
      expect(dots[0].getAttribute("data-bump")).toBe("major");
      expect(dots[1].getAttribute("data-bump")).toBe("minor");
    } finally {
      h.unmount();
    }
  });

  it("renders the installed → latest delta in mono font", async () => {
    const h = await mountDropdown();
    try {
      const rowText = (h.container.querySelector("[data-testid='update-dropdown-row']") as HTMLElement).textContent;
      expect(rowText).toContain("1.0.0 → 2.0.0");
    } finally {
      h.unmount();
    }
  });

  it("clicking a row invokes onSelectSkill with the skill descriptor", async () => {
    const h = await mountDropdown();
    try {
      const row = h.container.querySelector("[data-testid='update-dropdown-row']") as HTMLButtonElement;
      await h.act(() => { row.click(); });
      expect(h.handlers.onSelectSkill).toHaveBeenCalledTimes(1);
      expect((h.handlers.onSelectSkill as ReturnType<typeof vi.fn>).mock.calls[0][0].name).toBe("plugin-a/skill-x");
    } finally {
      h.unmount();
    }
  });

  it("Refresh button reads 'Refreshing…' and is disabled while refreshing", async () => {
    const h = await mountDropdown({ isRefreshing: true });
    try {
      const btn = h.container.querySelector("[data-testid='update-dropdown-refresh']") as HTMLButtonElement;
      expect(btn.textContent).toBe("Refreshing…");
      expect(btn.disabled).toBe(true);
    } finally {
      h.unmount();
    }
  });

  it("Refresh button invokes onRefresh when enabled", async () => {
    const h = await mountDropdown({ isRefreshing: false });
    try {
      const btn = h.container.querySelector("[data-testid='update-dropdown-refresh']") as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
      await h.act(() => { btn.click(); });
      expect(h.handlers.onRefresh).toHaveBeenCalledTimes(1);
    } finally {
      h.unmount();
    }
  });

  it("View all button invokes onViewAll", async () => {
    const h = await mountDropdown();
    try {
      const viewAll = h.container.querySelector("[data-testid='update-dropdown-view-all']") as HTMLButtonElement;
      await h.act(() => { viewAll.click(); });
      expect(h.handlers.onViewAll).toHaveBeenCalledTimes(1);
    } finally {
      h.unmount();
    }
  });

  it("Escape key invokes onClose", async () => {
    const h = await mountDropdown();
    try {
      await h.act(() => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      });
      expect(h.handlers.onClose).toHaveBeenCalled();
    } finally {
      h.unmount();
    }
  });

  it("empty state when no outdated skills present", async () => {
    const h = await mountDropdown({
      updates: [
        { name: "p/a", installed: "1.0.0", latest: "1.0.0", updateAvailable: false },
      ],
    });
    try {
      expect(h.container.querySelectorAll("[data-testid='update-dropdown-row']")).toHaveLength(0);
      expect(h.container.textContent).toContain("No updates available");
    } finally {
      h.unmount();
    }
  });

  it("role='dialog' + aria-modal='false' on the root popover", async () => {
    const h = await mountDropdown();
    try {
      const root = h.container.querySelector("[data-testid='update-dropdown']") as HTMLElement;
      expect(root.getAttribute("role")).toBe("dialog");
      expect(root.getAttribute("aria-modal")).toBe("false");
    } finally {
      h.unmount();
    }
  });
});
