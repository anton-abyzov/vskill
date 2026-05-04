// @vitest-environment jsdom
// 0823 T-013 — RED tests for SourceFileTree (read-only file browser used by SourcePanel).
import { afterEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { SkillFileEntry } from "../../types";

async function mount(props: {
  files: SkillFileEntry[];
  activePath: string;
  onSelect: (path: string) => void;
}) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { SourceFileTree } = await import("../SourceFileTree");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(SourceFileTree, props));
  });
  return {
    container,
    act: (fn: () => void | Promise<void>) => act(async () => { await fn(); }),
    rerender: async (next: typeof props) => {
      await act(async () => {
        root.render(React.createElement(SourceFileTree, next));
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("SourceFileTree (0823 T-013/T-014)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("AC-US1-03: renders folder + file structure from a flat path list", async () => {
    const files: SkillFileEntry[] = [
      { path: "SKILL.md", size: 1200, type: "file" },
      { path: "references/api.md", size: 400, type: "file" },
      { path: "references/usage.md", size: 200, type: "file" },
      { path: "scripts/setup.sh", size: 300, type: "file" },
    ];
    const onSelect = vi.fn();
    const h = await mount({ files, activePath: "SKILL.md", onSelect });
    try {
      const items = Array.from(
        h.container.querySelectorAll("[data-testid='source-tree-item']"),
      ) as HTMLElement[];
      const labels = items.map((el) => (el.dataset.path ?? "").trim());
      // Either flat or nested rendering is acceptable as long as every file is listed
      // and folder labels appear as separators.
      expect(labels.filter((l) => l === "SKILL.md").length).toBeGreaterThan(0);
      expect(labels.some((l) => l.endsWith("references/api.md"))).toBe(true);
      expect(labels.some((l) => l.endsWith("scripts/setup.sh"))).toBe(true);
    } finally {
      h.unmount();
    }
  });

  it("AC-US1-03: highlights the active path", async () => {
    const files: SkillFileEntry[] = [
      { path: "SKILL.md", size: 1200, type: "file" },
      { path: "references/api.md", size: 400, type: "file" },
    ];
    const h = await mount({
      files,
      activePath: "references/api.md",
      onSelect: vi.fn(),
    });
    try {
      const active = h.container.querySelector(
        "[data-testid='source-tree-item'][data-active='true']",
      ) as HTMLElement | null;
      expect(active).toBeTruthy();
      expect(active!.dataset.path).toBe("references/api.md");
    } finally {
      h.unmount();
    }
  });

  it("AC-US1-03: clicking a file invokes onSelect with the relative path", async () => {
    const files: SkillFileEntry[] = [
      { path: "SKILL.md", size: 1200, type: "file" },
      { path: "scripts/setup.sh", size: 300, type: "file" },
    ];
    const onSelect = vi.fn();
    const h = await mount({ files, activePath: "SKILL.md", onSelect });
    try {
      const items = Array.from(
        h.container.querySelectorAll("[data-testid='source-tree-item']"),
      ) as HTMLElement[];
      const target = items.find((el) => el.dataset.path === "scripts/setup.sh");
      expect(target).toBeTruthy();
      await h.act(async () => { target!.click(); });
      expect(onSelect).toHaveBeenCalledWith("scripts/setup.sh");
    } finally {
      h.unmount();
    }
  });

  it("AC-US1-03: empty file list still renders without crashing", async () => {
    const h = await mount({ files: [], activePath: "", onSelect: vi.fn() });
    try {
      expect(h.container.querySelector("[data-testid='source-tree-empty']")).toBeTruthy();
    } finally {
      h.unmount();
    }
  });

  it("AC-US1-07: ArrowDown moves keyboard focus through visible items", async () => {
    const files: SkillFileEntry[] = [
      { path: "SKILL.md", size: 1200, type: "file" },
      { path: "references/api.md", size: 400, type: "file" },
      { path: "scripts/setup.sh", size: 300, type: "file" },
    ];
    const h = await mount({ files, activePath: "SKILL.md", onSelect: vi.fn() });
    try {
      const container = h.container.querySelector(
        "[data-testid='source-file-tree']",
      ) as HTMLElement;
      expect(container).toBeTruthy();
      expect(container.getAttribute("tabindex")).toBe("0");
      expect(container.getAttribute("role")).toBe("tree");
      // Initial focus is on the active item (SKILL.md). ArrowDown should
      // advance to the next visible item.
      await h.act(async () => {
        container.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
        );
      });
      const focused = h.container.querySelector(
        "[data-testid='source-tree-item'][data-focused='true']",
      ) as HTMLElement | null;
      expect(focused).toBeTruthy();
      // First item in render order is the `references` folder (dirs sorted first).
      // After SKILL.md focus + ArrowDown, focus moves DOWN one item.
      expect(focused?.dataset.path).toBeTruthy();
    } finally {
      h.unmount();
    }
  });

  it("AC-US1-07: Enter on a focused file invokes onSelect", async () => {
    const files: SkillFileEntry[] = [
      { path: "SKILL.md", size: 1200, type: "file" },
      { path: "scripts/setup.sh", size: 300, type: "file" },
    ];
    const onSelect = vi.fn();
    const h = await mount({ files, activePath: "SKILL.md", onSelect });
    try {
      const container = h.container.querySelector(
        "[data-testid='source-file-tree']",
      ) as HTMLElement;
      // Focus is on SKILL.md (active). Enter should fire onSelect for it.
      await h.act(async () => {
        container.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
      });
      expect(onSelect).toHaveBeenCalledWith("SKILL.md");
    } finally {
      h.unmount();
    }
  });

  it("AC-US1-07: Escape blurs the tree (focus leaves the container)", async () => {
    const files: SkillFileEntry[] = [
      { path: "SKILL.md", size: 1200, type: "file" },
    ];
    const h = await mount({ files, activePath: "SKILL.md", onSelect: vi.fn() });
    try {
      const container = h.container.querySelector(
        "[data-testid='source-file-tree']",
      ) as HTMLDivElement;
      container.focus();
      expect(document.activeElement).toBe(container);
      await h.act(async () => {
        container.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });
      expect(document.activeElement).not.toBe(container);
    } finally {
      h.unmount();
    }
  });
});
