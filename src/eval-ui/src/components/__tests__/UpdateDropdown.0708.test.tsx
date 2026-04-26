// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 0747 T-007: UpdateDropdown now consumes useToast for inline Update toasts.
vi.mock("../ToastProvider", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), clear: vi.fn() }),
}));

// 0766 F-002: stub StudioContext for the new onSkillUpdated dependency.
vi.mock("../../StudioContext", () => ({
  useStudio: () => ({ onSkillUpdated: vi.fn() }),
}));

const updates = [
  { name: "plugin-a/skill-x", installed: "1.0.0", latest: "2.0.0", updateAvailable: true },
  { name: "plugin-b/skill-y", installed: "1.0.0", latest: "1.1.0", updateAvailable: true },
];

async function mountDropdown(
  props: Partial<Parameters<typeof import("../UpdateDropdown").default>[0]> = {},
) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const UpdateDropdown = (await import("../UpdateDropdown")).default;

  const resolved = {
    updates: props.updates ?? updates,
    isRefreshing: props.isRefreshing ?? false,
    onRefresh: props.onRefresh ?? vi.fn(),
    onSelectSkill: props.onSelectSkill ?? vi.fn(),
    onViewAll: props.onViewAll ?? vi.fn(),
    onClose: props.onClose ?? vi.fn(),
    diffSummariesById: props.diffSummariesById,
  };

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(UpdateDropdown, resolved));
  });
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("UpdateDropdown 0708 (T-035/T-036, AC-US5-03 diffSummary)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders diffSummary under a row when provided", async () => {
    const diffs = new Map<string, string>([
      ["plugin-a/skill-x", "adds table-of-contents support"],
    ]);
    const h = await mountDropdown({ diffSummariesById: diffs });
    try {
      const diffEls = h.container.querySelectorAll(
        "[data-testid='update-dropdown-diff-summary']",
      );
      expect(diffEls).toHaveLength(1);
      expect(diffEls[0].textContent).toBe("adds table-of-contents support");
    } finally {
      h.unmount();
    }
  });

  it("does not render any diffSummary element when map is missing", async () => {
    const h = await mountDropdown({});
    try {
      expect(
        h.container.querySelectorAll("[data-testid='update-dropdown-diff-summary']"),
      ).toHaveLength(0);
    } finally {
      h.unmount();
    }
  });

  it("renders diffSummary only for rows whose name matches a map key", async () => {
    const diffs = new Map<string, string>([
      ["plugin-b/skill-y", "fix crash on large inputs"],
    ]);
    const h = await mountDropdown({ diffSummariesById: diffs });
    try {
      const diffEls = h.container.querySelectorAll(
        "[data-testid='update-dropdown-diff-summary']",
      );
      expect(diffEls).toHaveLength(1);
      expect(diffEls[0].textContent).toBe("fix crash on large inputs");
    } finally {
      h.unmount();
    }
  });
});
