// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0894 — a per-agent remove refused because the skill lives in the shared
// .agents/skills folder offers "Remove from all agents", which calls the
// remove route with every agent that still uses it and `all: true`.
// ---------------------------------------------------------------------------

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { InstallTargetsModal } from "../InstallTargetsModal";
import type { SupportedAgent } from "../../types";
import type { InstallStateResponse } from "../../types/install-state";

const AGENTS: SupportedAgent[] = [
  { id: "cursor", displayName: "Cursor", detected: true, tier: 2, installMode: "filesystem", resolvedGlobalDir: "/h/.cursor/skills", resolvedLocalDir: ".cursor/skills" },
  { id: "codex", displayName: "Codex CLI", detected: true, tier: 1, installMode: "filesystem", resolvedGlobalDir: "/h/.agents/skills", resolvedLocalDir: ".agents/skills" },
];

const INSTALL_STATE: InstallStateResponse = {
  skill: "o/r/foo",
  detectedAgentTools: [],
  scopes: {
    project: { installed: true, installedAgentTools: ["cursor", "codex"], version: "1.0.0" },
    user: { installed: false, installedAgentTools: [], version: null },
  },
};

let container: HTMLDivElement;
let root: Root;
let removeSkillImpl: ReturnType<typeof vi.fn>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  removeSkillImpl = vi.fn();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

const byTestId = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
  });
}

async function renderModal(onRemoved?: () => void) {
  act(() => {
    root.render(
      <InstallTargetsModal
        skill="o/r/foo"
        scope="project"
        activeAgentId={null}
        onClose={() => {}}
        onRemoved={onRemoved}
        fetchSupportedAgentsImpl={vi.fn(async () => AGENTS) as unknown as never}
        fetchInstallStateImpl={vi.fn(async () => INSTALL_STATE)}
        removeSkillImpl={removeSkillImpl as unknown as never}
      />,
    );
  });
  await flush();
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await flush();
}

describe("0894 — InstallTargetsModal shared remove", () => {
  it("offers Remove from all agents after a shared refusal and sends all: true", async () => {
    removeSkillImpl
      .mockResolvedValueOnce({
        skill: "o/r/foo",
        scope: "project",
        removed: [],
        skipped: [{ agentId: "cursor", reason: "shared: … still used by codex", sharedWith: ["codex"] }],
        errors: [],
      })
      .mockResolvedValueOnce({
        skill: "o/r/foo",
        scope: "project",
        removed: [{ agentId: "cursor", path: "/p/.agents/skills/foo" }],
        skipped: [],
        errors: [],
      });
    await renderModal();

    await click(byTestId("install-targets-remove-cursor")!);

    const notice = byTestId("install-targets-remove-shared");
    expect(notice?.textContent).toContain("codex");
    await click(byTestId("install-targets-remove-all")!);

    expect(removeSkillImpl).toHaveBeenLastCalledWith({
      skill: "o/r/foo",
      scope: "project",
      agentIds: ["cursor", "codex"],
      all: true,
    });
    expect(byTestId("install-targets-remove-shared")).toBeNull();
    expect(byTestId("install-targets-remove-error")).toBeNull();
  });

  it("shows a remove error outside the install phases", async () => {
    removeSkillImpl.mockResolvedValueOnce({
      skill: "o/r/foo",
      scope: "project",
      removed: [],
      skipped: [],
      errors: [{ agentId: "cursor", message: "EACCES" }],
    });
    await renderModal();

    await click(byTestId("install-targets-remove-cursor")!);

    expect(byTestId("install-targets-remove-error")?.textContent).toContain("EACCES");
    expect(byTestId("install-targets-remove-all")).toBeNull();
  });

  it("tells the caller after a remove so it can refresh its installed list", async () => {
    removeSkillImpl.mockResolvedValueOnce({
      skill: "o/r/foo",
      scope: "project",
      removed: [{ agentId: "cursor", path: "/p/.cursor/skills/foo" }],
      skipped: [],
      errors: [],
    });
    const onRemoved = vi.fn();
    await renderModal(onRemoved);

    await click(byTestId("install-targets-remove-cursor")!);

    expect(onRemoved).toHaveBeenCalledTimes(1);
  });
});
