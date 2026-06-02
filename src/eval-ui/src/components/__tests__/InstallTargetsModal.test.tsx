// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0845 T-019 — InstallTargetsModal unit tests.
//
// ACs covered:
//   - AC-US2-02: tier-grouped sections, detected sorts above undetected
//   - AC-US2-03: only currently-active tool is pre-checked
//   - AC-US2-04: Select all detected / Clear quick actions
//   - AC-US2-05: Install disabled at 0 selected with "Select at least one target" tooltip
//   - AC-US2-06: submit POSTs `{ skill, agentIds, scope }` and consumes SSE
//   - AC-US2-07: per-target result toast with mixed outcomes
//   - AC-US2-08: Cancel closes without firing any API call
//   - AC-US5-01: Tier 3 rows appear in the cloud section
//   - AC-US5-02: Tier 3 rows show "Copy to clipboard" instead of a filesystem path
//   - AC-US5-08: ClipboardExportDialog opens after SSE stream closes (mixed install)
// ---------------------------------------------------------------------------

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { InstallTargetsModal } from "../InstallTargetsModal";
import type {
  AgentInstallResult,
  SupportedAgent,
} from "../../types";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const FIXTURE_AGENTS: SupportedAgent[] = [
  {
    id: "claude-code",
    displayName: "Claude Code",
    detected: true,
    tier: 1,
    installMode: "filesystem",
    resolvedGlobalDir: "/home/user/.claude/skills",
    resolvedLocalDir: ".claude/skills",
  },
  {
    id: "codex",
    displayName: "Codex CLI",
    detected: false,
    tier: 1,
    installMode: "filesystem",
    resolvedGlobalDir: "/home/user/.codex/skills",
    resolvedLocalDir: ".codex/skills",
  },
  {
    id: "antigravity",
    displayName: "Antigravity",
    detected: true,
    tier: 1,
    installMode: "filesystem",
    resolvedGlobalDir: "/home/user/.gemini/antigravity/skills",
    resolvedLocalDir: ".agent/skills",
  },
  {
    id: "cursor",
    displayName: "Cursor",
    detected: true,
    tier: 2,
    installMode: "filesystem",
    resolvedGlobalDir: "/home/user/.cursor/skills",
    resolvedLocalDir: ".cursor/skills",
  },
  {
    id: "windsurf",
    displayName: "Windsurf",
    detected: false,
    tier: 2,
    installMode: "filesystem",
    resolvedGlobalDir: "/home/user/.windsurf/skills",
    resolvedLocalDir: ".windsurf/skills",
  },
  {
    id: "chatgpt",
    displayName: "ChatGPT Custom Instructions",
    detected: false,
    tier: 3,
    installMode: "clipboard",
    resolvedGlobalDir: "(clipboard)",
    resolvedLocalDir: "",
    pasteInstructionsUrl: "https://chatgpt.com/#settings/Personalization",
    docsUrl: "https://chatgpt.com/help",
  },
];

// Fake EventSource — mirrors the InstallEngineModal test pattern.
type Listener = (ev: MessageEvent) => void;
class FakeEventSource {
  url: string;
  listeners = new Map<string, Listener[]>();
  closed = false;
  static instances: FakeEventSource[] = [];
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(cb);
    this.listeners.set(type, list);
  }
  emit(type: string, data: unknown): void {
    const list = this.listeners.get(type) ?? [];
    const ev = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const cb of list) cb(ev);
  }
  close(): void {
    this.closed = true;
  }
  set onerror(_v: unknown) { /* unused */ }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let container: HTMLDivElement;
let root: Root;
let fetchSupportedAgentsImpl: ReturnType<typeof vi.fn>;
let installToAgentsImpl: ReturnType<typeof vi.fn>;
let startInstallStreamImpl: ReturnType<typeof vi.fn>;
let writeClipboardImpl: ReturnType<typeof vi.fn>;
let lastStreamCallbacks: {
  onResult: (r: AgentInstallResult) => void;
  onDone: (s: { success?: boolean; error?: string; results: AgentInstallResult[] }) => void;
  onError?: (err: Error) => void;
} | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  FakeEventSource.instances = [];
  fetchSupportedAgentsImpl = vi.fn(async () => FIXTURE_AGENTS);
  installToAgentsImpl = vi.fn(async () => ({ jobId: "job-uuid-abc" }));
  lastStreamCallbacks = null;
  startInstallStreamImpl = vi.fn((_jobId, callbacks) => {
    lastStreamCallbacks = callbacks;
    return { close: vi.fn() };
  });
  writeClipboardImpl = vi.fn(async () => undefined);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

function findByTestId(id: string): HTMLElement | null {
  return document.querySelector(`[data-testid="${id}"]`);
}

function getByTestId(id: string): HTMLElement {
  const el = findByTestId(id);
  if (!el) throw new Error(`testid "${id}" not found`);
  return el;
}

async function flushAsync(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
  });
}

function renderModal(propOverrides: {
  skill?: string;
  activeAgentId?: string | null;
  scope?: "project" | "user";
  preCheckedAgentIds?: string[];
  onClose?: () => void;
  onSuccess?: (results: AgentInstallResult[]) => void;
} = {}) {
  act(() => {
    root.render(
      <InstallTargetsModal
        skill={propOverrides.skill ?? "anton-abyzov/vskill/obsidian-brain"}
        skillDisplayName="obsidian-brain"
        scope={propOverrides.scope ?? "user"}
        activeAgentId={
          propOverrides.activeAgentId === undefined
            ? "claude-code"
            : propOverrides.activeAgentId
        }
        preCheckedAgentIds={propOverrides.preCheckedAgentIds}
        onClose={propOverrides.onClose ?? (() => {})}
        onSuccess={propOverrides.onSuccess}
        fetchSupportedAgentsImpl={fetchSupportedAgentsImpl as unknown as never}
        installToAgentsImpl={installToAgentsImpl as unknown as never}
        startInstallStreamImpl={startInstallStreamImpl as unknown as never}
        writeClipboardImpl={writeClipboardImpl as unknown as never}
      />,
    );
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InstallTargetsModal — AC-US2-02: tier-grouped sections", () => {
  it("renders Drop-in, Format-converted, and Cloud sections with title 'Install <skill name> to:'", async () => {
    renderModal();
    await flushAsync();
    expect(getByTestId("install-targets-modal-title").textContent).toContain(
      "Install obsidian-brain to:",
    );
    expect(findByTestId("install-targets-section-dropin")).toBeTruthy();
    expect(findByTestId("install-targets-section-format-converted")).toBeTruthy();
    expect(findByTestId("install-targets-section-cloud")).toBeTruthy();
  });

  it("detected agents sort above undetected within each tier", async () => {
    renderModal();
    await flushAsync();
    const dropin = getByTestId("install-targets-section-dropin");
    const rows = dropin.querySelectorAll('[data-testid^="install-targets-row-"]');
    // detected: claude-code, antigravity (alpha). undetected: codex.
    expect(rows.length).toBe(3);
    expect(rows[0].getAttribute("data-detected")).toBe("true");
    expect(rows[1].getAttribute("data-detected")).toBe("true");
    expect(rows[2].getAttribute("data-detected")).toBe("false");
  });

  it("renders above the skill detail dialog layer", async () => {
    renderModal();
    await flushAsync();
    const backdrop = getByTestId("install-targets-modal-backdrop");
    expect(Number(backdrop.style.zIndex)).toBeGreaterThan(9998);
  });
});

describe("InstallTargetsModal — AC-US2-03: pre-check only the active tool", () => {
  it("only the currently active tool is pre-checked", async () => {
    renderModal({ activeAgentId: "claude-code" });
    await flushAsync();
    expect(
      getByTestId("install-targets-row-claude-code").getAttribute("data-checked"),
    ).toBe("true");
    expect(
      getByTestId("install-targets-row-codex").getAttribute("data-checked"),
    ).toBe("false");
    expect(
      getByTestId("install-targets-row-cursor").getAttribute("data-checked"),
    ).toBe("false");
    expect(
      getByTestId("install-targets-row-chatgpt").getAttribute("data-checked"),
    ).toBe("false");
  });

  it("preCheckedAgentIds union with the active tool selects multiple rows", async () => {
    renderModal({ activeAgentId: "claude-code", preCheckedAgentIds: ["codex"] });
    await flushAsync();
    expect(
      getByTestId("install-targets-row-claude-code").getAttribute("data-checked"),
    ).toBe("true");
    expect(
      getByTestId("install-targets-row-codex").getAttribute("data-checked"),
    ).toBe("true");
  });

  it("maps provider ids to install target ids before pre-checking", async () => {
    renderModal({ activeAgentId: "codex-cli" });
    await flushAsync();
    expect(
      getByTestId("install-targets-row-codex").getAttribute("data-checked"),
    ).toBe("true");
    expect(
      getByTestId("install-targets-row-claude-code").getAttribute("data-checked"),
    ).toBe("false");
  });

  it("falls back to a detected filesystem target when no active tool is known", async () => {
    renderModal({ activeAgentId: null });
    await flushAsync();
    expect(
      getByTestId("install-targets-row-claude-code").getAttribute("data-checked"),
    ).toBe("true");
  });
});

describe("InstallTargetsModal — AC-US2-04 + AC-US2-05: quick actions + validation", () => {
  it("Select all detected checks every row with detected=true", async () => {
    renderModal({ activeAgentId: null });
    await flushAsync();
    act(() => getByTestId("install-targets-select-all-detected").click());
    expect(
      getByTestId("install-targets-row-claude-code").getAttribute("data-checked"),
    ).toBe("true");
    expect(
      getByTestId("install-targets-row-antigravity").getAttribute("data-checked"),
    ).toBe("true");
    expect(
      getByTestId("install-targets-row-cursor").getAttribute("data-checked"),
    ).toBe("true");
    expect(
      getByTestId("install-targets-row-codex").getAttribute("data-checked"),
    ).toBe("false");
    expect(
      getByTestId("install-targets-row-chatgpt").getAttribute("data-checked"),
    ).toBe("false");
  });

  it("Clear unchecks every row and disables Install with tooltip", async () => {
    renderModal({ activeAgentId: "claude-code" });
    await flushAsync();
    act(() => getByTestId("install-targets-clear").click());
    expect(
      getByTestId("install-targets-row-claude-code").getAttribute("data-checked"),
    ).toBe("false");
    const installBtn = getByTestId("install-targets-modal-install") as HTMLButtonElement;
    expect(installBtn.disabled).toBe(true);
    expect(installBtn.getAttribute("title")).toBe("Select at least one target");
  });
});

describe("InstallTargetsModal — AC-US2-08: Cancel does not fire any API call", () => {
  it("Cancel closes without calling installToAgents or writing toast", async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    await flushAsync();
    act(() => getByTestId("install-targets-modal-cancel").click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(installToAgentsImpl).not.toHaveBeenCalled();
    expect(startInstallStreamImpl).not.toHaveBeenCalled();
  });
});

describe("InstallTargetsModal — AC-US5-01 + AC-US5-02: cloud section + 'Copy to clipboard' path", () => {
  it("Tier 3 row appears in the cloud section and shows 'Copy to clipboard'", async () => {
    renderModal();
    await flushAsync();
    const cloudSection = getByTestId("install-targets-section-cloud");
    const chatRow = cloudSection.querySelector(
      '[data-testid="install-targets-row-chatgpt"]',
    );
    expect(chatRow).toBeTruthy();
    const path = getByTestId("install-targets-path-chatgpt");
    expect(path.textContent).toBe("Copy to clipboard");
  });
});

describe("InstallTargetsModal — AC-US2-06: submit fires POST + consumes SSE", () => {
  it("Install button submits agentIds[] + scope and starts SSE stream", async () => {
    renderModal({ activeAgentId: "claude-code" });
    await flushAsync();
    // Add cursor to selection.
    act(() => getByTestId("install-targets-checkbox-cursor").click());
    act(() => getByTestId("install-targets-modal-install").click());
    await flushAsync();
    expect(installToAgentsImpl).toHaveBeenCalledTimes(1);
    const callArg = installToAgentsImpl.mock.calls[0]?.[0];
    expect(callArg.skill).toBe("anton-abyzov/vskill/obsidian-brain");
    expect(callArg.scope).toBe("user");
    expect(new Set(callArg.agentIds)).toEqual(new Set(["claude-code", "cursor"]));
    expect(startInstallStreamImpl).toHaveBeenCalledTimes(1);
    expect(startInstallStreamImpl.mock.calls[0]?.[0]).toBe("job-uuid-abc");
  });

  it("per-agent result events update live status pills", async () => {
    renderModal({ activeAgentId: "claude-code" });
    await flushAsync();
    act(() => getByTestId("install-targets-modal-install").click());
    await flushAsync();
    expect(getByTestId("install-targets-modal-installing-status").textContent).toContain(
      "Installing obsidian-brain to 1 target",
    );
    expect(lastStreamCallbacks).not.toBeNull();
    act(() => {
      lastStreamCallbacks!.onResult({
        agentId: "claude-code",
        status: "installed",
        path: "/tmp/home/.claude/skills/obsidian-brain/SKILL.md",
      });
    });
    expect(
      getByTestId("install-targets-status-claude-code").getAttribute("data-status"),
    ).toBe("installed");
  });
});

describe("InstallTargetsModal — AC-US2-07: per-target result toast (mixed outcomes)", () => {
  it("calls onSuccess after a clean filesystem install and includes the installed path detail", async () => {
    const onSuccess = vi.fn();
    renderModal({ activeAgentId: "claude-code", onSuccess });
    await flushAsync();
    act(() => getByTestId("install-targets-modal-install").click());
    await flushAsync();
    act(() => {
      lastStreamCallbacks!.onDone({
        results: [
          {
            agentId: "claude-code",
            status: "installed",
            detail: "/tmp/home/.claude/skills/obsidian-brain/SKILL.md",
          },
        ],
      });
    });
    await flushAsync();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ agentId: "claude-code", status: "installed" }),
    ]);
    expect(getByTestId("install-targets-result-row-claude-code").textContent).toContain(
      "/tmp/home/.claude/skills/obsidian-brain/SKILL.md",
    );
  });

  it("turns a terminal SSE failure with no rows into a visible per-target error", async () => {
    const onSuccess = vi.fn();
    renderModal({ activeAgentId: "claude-code", onSuccess });
    await flushAsync();
    act(() => getByTestId("install-targets-modal-install").click());
    await flushAsync();
    act(() => {
      lastStreamCallbacks!.onDone({
        success: false,
        error: "Skill archive could not be written",
        results: [],
      });
    });
    await flushAsync();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const row = getByTestId("install-targets-result-row-claude-code");
    expect(row.getAttribute("data-status")).toBe("error");
    expect(row.textContent).toContain("Skill archive could not be written");
    expect(getByTestId("install-targets-modal-install-error").textContent).toContain(
      "Skill archive could not be written",
    );
    expect(onSuccess.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ agentId: "claude-code", status: "error" }),
    ]);
  });

  it("renders one row per agent with the right status, including a partial-failure row", async () => {
    renderModal({ activeAgentId: "claude-code" });
    await flushAsync();
    act(() => getByTestId("install-targets-checkbox-cursor").click());
    act(() => getByTestId("install-targets-checkbox-windsurf").click());
    act(() => getByTestId("install-targets-checkbox-chatgpt").click());
    act(() => getByTestId("install-targets-modal-install").click());
    await flushAsync();
    act(() => {
      lastStreamCallbacks!.onDone({
        results: [
          {
            agentId: "claude-code",
            status: "installed",
            path: "/tmp/home/.claude/skills/obsidian-brain/SKILL.md",
          },
          {
            agentId: "cursor",
            status: "installed",
            path: "/tmp/home/.cursor/rules/obsidian-brain.mdc",
          },
          {
            agentId: "windsurf",
            status: "error",
            detail: "transformer threw: bad frontmatter",
          },
          {
            agentId: "chatgpt",
            status: "exported",
            blob: "# obsidian-brain\n\nBody…",
            pasteInstructionsUrl:
              "https://chatgpt.com/#settings/Personalization",
          },
        ],
      });
    });
    await flushAsync();
    expect(findByTestId("install-targets-results-toast")).toBeTruthy();
    expect(
      getByTestId("install-targets-result-row-claude-code").getAttribute(
        "data-status",
      ),
    ).toBe("installed");
    expect(
      getByTestId("install-targets-result-row-cursor").getAttribute("data-status"),
    ).toBe("installed");
    expect(
      getByTestId("install-targets-result-row-windsurf").getAttribute(
        "data-status",
      ),
    ).toBe("error");
    expect(
      getByTestId("install-targets-result-row-chatgpt").getAttribute(
        "data-status",
      ),
    ).toBe("exported");
  });

  it("surfaces scope-downgrade warning text in the Tier 3 row", async () => {
    renderModal({ activeAgentId: null, scope: "project" });
    await flushAsync();
    act(() => getByTestId("install-targets-checkbox-chatgpt").click());
    act(() => getByTestId("install-targets-modal-install").click());
    await flushAsync();
    act(() => {
      lastStreamCallbacks!.onDone({
        results: [
          {
            agentId: "chatgpt",
            status: "exported",
            blob: "blob",
            detail:
              "ChatGPT does not support project-scoped skills; exported as user-scope blob.",
            pasteInstructionsUrl: "https://chatgpt.com/",
          },
        ],
      });
    });
    await flushAsync();
    const row = getByTestId("install-targets-result-row-chatgpt");
    expect(row.textContent).toMatch(/project-scoped/);
  });
});

describe("InstallTargetsModal — AC-US5-08: ClipboardExportDialog opens after SSE close", () => {
  it("mixed install: filesystem rows succeed, then ChatGPT clipboard dialog opens", async () => {
    renderModal({ activeAgentId: "claude-code" });
    await flushAsync();
    act(() => getByTestId("install-targets-checkbox-cursor").click());
    act(() => getByTestId("install-targets-checkbox-chatgpt").click());
    act(() => getByTestId("install-targets-modal-install").click());
    await flushAsync();

    // No clipboard dialog yet — stream hasn't closed.
    expect(findByTestId("clipboard-export-dialog")).toBeFalsy();

    act(() => {
      lastStreamCallbacks!.onDone({
        results: [
          {
            agentId: "claude-code",
            status: "installed",
            path: "/tmp/home/.claude/skills/obsidian-brain/SKILL.md",
          },
          {
            agentId: "cursor",
            status: "installed",
            path: "/tmp/home/.cursor/rules/obsidian-brain.mdc",
          },
          {
            agentId: "chatgpt",
            status: "exported",
            blob: "# obsidian-brain\nbody",
            pasteInstructionsUrl:
              "https://chatgpt.com/#settings/Personalization",
          },
        ],
      });
    });
    await flushAsync();

    const dialog = getByTestId("clipboard-export-dialog");
    expect(dialog.getAttribute("data-agent-id")).toBe("chatgpt");
    const clipboardBackdrop = getByTestId("clipboard-export-dialog-backdrop") as HTMLElement;
    const installBackdrop = getByTestId("install-targets-modal-backdrop") as HTMLElement;
    expect(Number(clipboardBackdrop.style.zIndex)).toBeGreaterThan(
      Number(installBackdrop.style.zIndex),
    );
    expect(getByTestId("clipboard-export-blob").textContent).toContain(
      "obsidian-brain",
    );
  });

  it("Copy button calls navigator.clipboard.writeText only on the click handler", async () => {
    renderModal({ activeAgentId: null });
    await flushAsync();
    act(() => getByTestId("install-targets-checkbox-chatgpt").click());
    act(() => getByTestId("install-targets-modal-install").click());
    await flushAsync();
    act(() => {
      lastStreamCallbacks!.onDone({
        results: [
          {
            agentId: "chatgpt",
            status: "exported",
            blob: "PASTE_ME",
            pasteInstructionsUrl: "https://chatgpt.com/",
          },
        ],
      });
    });
    await flushAsync();
    // No write before click — AC-US5-05.
    expect(writeClipboardImpl).not.toHaveBeenCalled();
    act(() => getByTestId("clipboard-export-copy").click());
    await flushAsync();
    expect(writeClipboardImpl).toHaveBeenCalledTimes(1);
    expect(writeClipboardImpl.mock.calls[0]?.[0]).toBe("PASTE_ME");
  });
});
