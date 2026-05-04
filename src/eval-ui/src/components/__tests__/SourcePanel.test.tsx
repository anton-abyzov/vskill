// @vitest-environment jsdom
// 0823 T-017 — RED tests for SourcePanel (two-pane SKILL.md + file tree).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { SkillFileContent, SkillFileEntry } from "../../types";

const skillFiles: SkillFileEntry[] = [
  { path: "SKILL.md", size: 1200, type: "file" },
  { path: "references/api.md", size: 400, type: "file" },
  { path: "scripts/setup.sh", size: 300, type: "file" },
  { path: "assets/logo.png", size: 9000, type: "file" },
  { path: "assets/payload.bin", size: 1024, type: "file" },
];

const skillMdContent = `---
name: slack-messaging
version: 1.0.0
description: "Slack."
---

# Slack Messaging

Body paragraph for testing.
`;

const filesByPath: Record<string, SkillFileContent> = {
  "SKILL.md": { path: "SKILL.md", content: skillMdContent, size: 1200 },
  "references/api.md": {
    path: "references/api.md",
    content: "# API Reference\n\nDetails.\n",
    size: 400,
  },
  "scripts/setup.sh": {
    path: "scripts/setup.sh",
    content: "#!/bin/bash\necho hello\n",
    size: 300,
  },
  "assets/logo.png": {
    path: "assets/logo.png",
    content: undefined,
    size: 9000,
    binary: true,
  },
  "assets/payload.bin": {
    path: "assets/payload.bin",
    content: undefined,
    size: 1024,
    binary: true,
  },
};

const getSkillFilesSpy = vi.fn(async () => ({ files: skillFiles }));
const getSkillFileSpy = vi.fn(async (_p: string, _s: string, path: string) => {
  const entry = filesByPath[path];
  if (!entry) throw new Error(`no fixture for ${path}`);
  return entry;
});

vi.mock("../../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getSkillFiles: getSkillFilesSpy,
      getSkillFile: getSkillFileSpy,
      // 0823 F-005: SourcePanel auto-fetches the envelope to populate the
      // provider chip when no explicit provider prop is passed.
      getSkillVersionsEnvelope: vi.fn(async () => ({
        versions: [],
        count: 0,
        source: "platform" as const,
        provider: "anthropic" as const,
        trackedForUpdates: false,
      })),
    },
  };
});

async function mount(props: { plugin: string; skill: string }) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { SourcePanel } = await import("../SourcePanel");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(SourcePanel, props));
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

async function flushAll() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

describe("SourcePanel (0823 T-017/T-018)", () => {
  beforeEach(() => {
    getSkillFilesSpy.mockClear();
    getSkillFileSpy.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("AC-US1-02: fetches files on mount and default-selects SKILL.md", async () => {
    const h = await mount({ plugin: ".claude", skill: "slack-messaging" });
    try {
      await h.act(async () => { await flushAll(); });
      expect(getSkillFilesSpy).toHaveBeenCalledWith(".claude", "slack-messaging");
      expect(getSkillFileSpy).toHaveBeenCalledWith(".claude", "slack-messaging", "SKILL.md");
      const tree = h.container.querySelector("[data-testid='source-file-tree']");
      expect(tree).toBeTruthy();
    } finally {
      h.unmount();
    }
  });

  it("AC-US1-02: renders SKILL.md body via the markdown viewer by default", async () => {
    const h = await mount({ plugin: ".claude", skill: "slack-messaging" });
    try {
      await h.act(async () => { await flushAll(); });
      const md = h.container.querySelector("[data-testid='source-md-viewer']");
      expect(md).toBeTruthy();
      // The body should make it into the rendered output somewhere.
      expect(h.container.textContent ?? "").toContain("Slack Messaging");
    } finally {
      h.unmount();
    }
  });

  it("AC-US1-03: clicking a different .md file fetches and renders it as markdown", async () => {
    const h = await mount({ plugin: ".claude", skill: "slack-messaging" });
    try {
      await h.act(async () => { await flushAll(); });
      const item = h.container.querySelector(
        "[data-testid='source-tree-item'][data-path='references/api.md']",
      ) as HTMLElement;
      expect(item).toBeTruthy();
      await h.act(async () => { item.click(); await flushAll(); });
      expect(getSkillFileSpy).toHaveBeenCalledWith(
        ".claude",
        "slack-messaging",
        "references/api.md",
      );
      const md = h.container.querySelector("[data-testid='source-md-viewer']");
      expect(md).toBeTruthy();
      expect(h.container.textContent ?? "").toContain("API Reference");
    } finally {
      h.unmount();
    }
  });

  it("AC-US1-04: code/text file renders in monospace TextFileViewer with content", async () => {
    const h = await mount({ plugin: ".claude", skill: "slack-messaging" });
    try {
      await h.act(async () => { await flushAll(); });
      const item = h.container.querySelector(
        "[data-testid='source-tree-item'][data-path='scripts/setup.sh']",
      ) as HTMLElement;
      await h.act(async () => { item.click(); await flushAll(); });
      const text = h.container.querySelector("[data-testid='source-text-viewer']");
      expect(text).toBeTruthy();
      expect(text!.textContent ?? "").toContain("#!/bin/bash");
    } finally {
      h.unmount();
    }
  });

  it("AC-US1-04: image file renders in ImageFileViewer with src pointing at /file?path=", async () => {
    const h = await mount({ plugin: ".claude", skill: "slack-messaging" });
    try {
      await h.act(async () => { await flushAll(); });
      const item = h.container.querySelector(
        "[data-testid='source-tree-item'][data-path='assets/logo.png']",
      ) as HTMLElement;
      await h.act(async () => { item.click(); await flushAll(); });
      const img = h.container.querySelector(
        "[data-testid='source-image-viewer'] img",
      ) as HTMLImageElement;
      expect(img).toBeTruthy();
      expect(img.src).toContain("/api/skills/.claude/slack-messaging/file");
      expect(img.src).toContain("path=assets%2Flogo.png");
    } finally {
      h.unmount();
    }
  });

  it("AC-US1-04: binary non-image file renders BinaryFilePlaceholder with size", async () => {
    const h = await mount({ plugin: ".claude", skill: "slack-messaging" });
    try {
      await h.act(async () => { await flushAll(); });
      const item = h.container.querySelector(
        "[data-testid='source-tree-item'][data-path='assets/payload.bin']",
      ) as HTMLElement;
      await h.act(async () => { item.click(); await flushAll(); });
      const placeholder = h.container.querySelector("[data-testid='source-binary-placeholder']");
      expect(placeholder).toBeTruthy();
      expect(placeholder!.textContent ?? "").toMatch(/Binary file/i);
      expect(placeholder!.textContent ?? "").toMatch(/1\.0 KB|1 KB/);
    } finally {
      h.unmount();
    }
  });
});
