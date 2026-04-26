// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0734 — InstallEngineModal integration tests (drives useInstallEngine).
// ACs: AC-US5-04 (confirm modal), AC-US5-05 (spinner/success/failure UX),
//      AC-US5-06 (success → onSuccess callback fires for detection refresh),
//      AC-US5-10 (full flow: missing → click [Install] → confirm → spinner → success).
// ---------------------------------------------------------------------------

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { InstallEngineModal } from "../InstallEngineModal";

// ---------------------------------------------------------------------------
// Fake EventSource — emits events on demand from the test.
// ---------------------------------------------------------------------------

type Listener = (ev: MessageEvent) => void;

class FakeEventSource {
  url: string;
  listeners = new Map<string, Listener[]>();
  readyState = 0;
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
}

let container: HTMLDivElement;
let root: Root;
let fakeFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  FakeEventSource.instances = [];
  fakeFetch = vi.fn(async () =>
    new Response(JSON.stringify({ jobId: "job-uuid-123" }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

function findByTestId(id: string): HTMLElement | null {
  return container.querySelector(`[data-testid="${id}"]`);
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

function renderModal(props: { engine: "vskill" | "anthropic-skill-creator"; onClose?: () => void; onSuccess?: () => void }) {
  act(() => {
    root.render(
      <InstallEngineModal
        engine={props.engine}
        onClose={props.onClose ?? (() => {})}
        onSuccess={props.onSuccess ?? (() => {})}
        hookOpts={{
          fetchImpl: fakeFetch as unknown as typeof fetch,
          eventSourceCtor: FakeEventSource as unknown as typeof EventSource,
        }}
      />,
    );
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AC-US5-04: confirm stage shows the exact command + security note", () => {
  it("renders the vskill install command verbatim", () => {
    renderModal({ engine: "vskill" });
    const preview = getByTestId("install-command-preview");
    expect(preview.textContent).toContain(
      "vskill install anton-abyzov/vskill/plugins/skills/skills/skill-builder",
    );
    expect(getByTestId("install-security-note").textContent).toContain(
      "This runs the command in your terminal as your user",
    );
  });

  it("renders the anthropic install command verbatim", () => {
    renderModal({ engine: "anthropic-skill-creator" });
    const preview = getByTestId("install-command-preview");
    expect(preview.textContent).toContain("claude plugin install skill-creator");
  });

  it("Cancel fires onClose and does not invoke fetch", () => {
    const onClose = vi.fn();
    renderModal({ engine: "vskill", onClose });
    act(() => getByTestId("install-cancel").click());
    expect(onClose).toHaveBeenCalled();
    expect(fakeFetch).not.toHaveBeenCalled();
  });
});

describe("AC-US5-05 + AC-US5-10: success path — confirm → run → stream → success", () => {
  it("clicking [Run install] POSTs and opens an EventSource to the streaming endpoint", async () => {
    renderModal({ engine: "vskill" });
    act(() => getByTestId("install-run").click());
    await flushAsync();

    expect(fakeFetch).toHaveBeenCalledWith(
      "/api/studio/install-engine",
      expect.objectContaining({ method: "POST" }),
    );
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe("/api/studio/install-engine/job-uuid-123/stream");
    expect(getByTestId("install-spinner")).toBeTruthy();
  });

  it("progress events update the live-tail; done event with success=true triggers SuccessStage + onSuccess", async () => {
    const onSuccess = vi.fn();
    renderModal({ engine: "vskill", onSuccess });

    act(() => getByTestId("install-run").click());
    await flushAsync();

    const source = FakeEventSource.instances[0];
    act(() => source.emit("progress", { stream: "stdout", line: "Resolving..." }));
    act(() => source.emit("progress", { stream: "stdout", line: "Installed." }));
    expect(getByTestId("install-live-tail").textContent).toContain("Installed.");

    act(() => source.emit("done", { success: true, exitCode: 0, stderr: "" }));
    await flushAsync();

    expect(findByTestId("install-success")).toBeTruthy();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(source.closed).toBe(true);
  });
});

describe("AC-US5-05: failure path — non-zero exit shows stderr + retry", () => {
  it("renders failure UI with stderr and a working [Retry] button", async () => {
    renderModal({ engine: "anthropic-skill-creator" });

    act(() => getByTestId("install-run").click());
    await flushAsync();

    const source = FakeEventSource.instances[0];
    act(() => source.emit("progress", { stream: "stderr", line: "network unreachable" }));
    act(() => source.emit("done", { success: false, exitCode: 1, stderr: "network unreachable" }));
    await flushAsync();

    expect(findByTestId("install-failure")).toBeTruthy();
    expect(findByTestId("install-retry")).toBeTruthy();

    // Retry restarts the flow — fetch fires a second time.
    fakeFetch.mockClear();
    act(() => getByTestId("install-retry").click());
    await flushAsync();
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it("412 prerequisite-missing response surfaces remediation in failure stage", async () => {
    fakeFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "claude-cli-missing",
          remediation: "Install Claude Code CLI first: https://docs.claude.com/claude-code",
        }),
        { status: 412, headers: { "Content-Type": "application/json" } },
      ),
    );
    renderModal({ engine: "anthropic-skill-creator" });
    act(() => getByTestId("install-run").click());
    await flushAsync();

    expect(findByTestId("install-failure")).toBeTruthy();
    // The error message contains the remediation text.
    expect(container.textContent).toContain("Install Claude Code CLI first");
    // No EventSource opened for a pre-flight failure.
    expect(FakeEventSource.instances).toHaveLength(0);
  });
});
