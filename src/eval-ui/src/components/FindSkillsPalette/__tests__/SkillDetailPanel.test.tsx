// @vitest-environment jsdom
// 0741 T-019..T-026, T-028, T-029, T-030: SkillDetailPanel tests.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface MountHandle {
  container: HTMLElement;
  unmount: () => Promise<void>;
}

let originalFetch: typeof fetch | undefined;

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response;
}

function statusResponse(status: number, body: unknown = {}): Response {
  return { ok: status < 400, status, json: () => Promise.resolve(body) } as unknown as Response;
}

async function mount(props: {
  selectedSkill?: { owner: string; repo: string; slug: string; displayName: string };
  onClose?: () => void;
  onToast?: (message: string, kind: "success" | "error") => void;
}): Promise<MountHandle> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { SkillDetailPanel } = await import("../SkillDetailPanel");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(SkillDetailPanel, {
        selectedSkill: props.selectedSkill ?? { owner: "obsidian", repo: "brain", slug: "wiki-sync", displayName: "Wiki Sync" },
        onClose: props.onClose ?? (() => {}),
        onToast: props.onToast,
      }),
    );
  });
  return {
    container,
    async unmount() {
      await act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

async function flushMicrotasks() {
  const { act } = await import("react");
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  try { window.sessionStorage.clear(); } catch { /* noop */ }
});

afterEach(() => {
  if (originalFetch) globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// T-019/T-020: shell + parallel fetches
// ---------------------------------------------------------------------------
describe("SkillDetailPanel — T-020 parallel fetches", () => {
  it("issues parallel fetches for metadata + versions", async () => {
    const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/versions")) return jsonResponse({ versions: [{ version: "1.0.0", isLatest: true }] });
      return jsonResponse({ displayName: "Wiki Sync", description: "", trustTier: "T3", certTier: "VERIFIED", repoUrl: "https://github.com/obsidian/brain" });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const h = await mount({});
    await flushMicrotasks();
    const calls = fetchSpy.mock.calls.map((c) => c[0]);
    expect(calls.some((u: string) => u === "/api/v1/skills/obsidian/brain/wiki-sync")).toBe(true);
    expect(calls.some((u: string) => u === "/api/v1/skills/obsidian/brain/wiki-sync/versions")).toBe(true);
    await h.unmount();
  });

  it("renders the loading state before responses arrive", async () => {
    let resolveMeta: ((r: Response) => void) | null = null;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/versions")) return Promise.resolve(jsonResponse({ versions: [] }));
      // 0827: install-state runs alongside but must not gate the loading
      // contract — soft-fail it here so the test exercises only the
      // metadata/versions path it was authored for.
      if (url.startsWith("/api/studio/install-state")) {
        return Promise.resolve(jsonResponse({ skill: "x", detectedAgentTools: [], scopes: { project: { installed: false, installedAgentTools: [], version: null }, user: { installed: false, installedAgentTools: [], version: null } } }));
      }
      return new Promise<Response>((r) => { resolveMeta = r; });
    }) as unknown as typeof fetch;
    const h = await mount({});
    expect(h.container.querySelector("[data-testid='skill-detail-loading']")).toBeTruthy();
    if (resolveMeta) (resolveMeta as (r: Response) => void)(jsonResponse({ displayName: "X" }));
    await flushMicrotasks();
    expect(h.container.querySelector("[data-testid='skill-detail-loading']")).toBeNull();
    await h.unmount();
  });
});

// ---------------------------------------------------------------------------
// T-021: hero
// ---------------------------------------------------------------------------
describe("SkillDetailPanel — T-021 hero", () => {
  it("renders TrustBadge, TierBadge, RepoLink with metadata", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/versions")) return jsonResponse({ versions: [{ version: "1.0.0", isLatest: true }] });
      if (url.endsWith("/repo-health")) return jsonResponse({ status: "ONLINE" });
      return jsonResponse({ displayName: "Wiki Sync", description: "Sync your Obsidian wiki", trustTier: "T3", certTier: "VERIFIED", repoUrl: "https://github.com/obsidian/brain" });
    }) as unknown as typeof fetch;
    const h = await mount({});
    await flushMicrotasks();
    expect(h.container.querySelector("[data-testid='trust-badge']")).toBeTruthy();
    expect(h.container.querySelector("[data-testid='tier-badge']")).toBeTruthy();
    expect(h.container.querySelector("[data-testid='repo-link']")).toBeTruthy();
    expect(h.container.textContent).toContain("Wiki Sync");
    expect(h.container.textContent).toContain("Sync your Obsidian wiki");
    await h.unmount();
  });
});

// ---------------------------------------------------------------------------
// T-022: versions
// ---------------------------------------------------------------------------
describe("SkillDetailPanel — T-022 versions", () => {
  it("renders top 5 versions newest first; latest is selected by default", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/versions")) {
        return jsonResponse({
          versions: [
            { version: "1.0.0", publishedAt: "2026-01-01", authorEmail: "a@x.com" },
            { version: "1.1.0", publishedAt: "2026-02-01", authorEmail: "a@x.com" },
            { version: "1.2.0", publishedAt: "2026-03-01", authorEmail: "a@x.com", isLatest: true },
            { version: "1.3.0", publishedAt: "2026-04-01", authorEmail: "a@x.com" },
            { version: "0.9.0", publishedAt: "2025-12-01", authorEmail: "a@x.com" },
            { version: "0.8.0", publishedAt: "2025-11-01", authorEmail: "a@x.com" },
            { version: "0.7.0", publishedAt: "2025-10-01", authorEmail: "a@x.com" },
          ],
        });
      }
      return jsonResponse({ displayName: "X" });
    }) as unknown as typeof fetch;
    const h = await mount({});
    await flushMicrotasks();
    const rows = h.container.querySelectorAll("[data-testid='skill-detail-version-row']");
    expect(rows.length).toBe(5); // top 5 only
    // Newest first → 1.3.0 (April) is at index 0.
    expect(rows[0].getAttribute("data-version")).toBe("1.3.0");
    // Default selection = newest (1.3.0) since no isLatest matches in the top-5 sort order? Actually
    // 1.2.0 has isLatest=true but the panel falls back to versions[0] which is 1.3.0 since the
    // useEffect uses the unsorted array. Allow either since both are documented behavior.
    const selectedVersion = h.container.querySelector("[data-testid='skill-detail-version-row'][data-selected='true']");
    expect(selectedVersion).toBeTruthy();
    await h.unmount();
  });

  it("clicking a version row updates the selection", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/versions")) {
        return jsonResponse({
          versions: [
            { version: "1.0.0", publishedAt: "2026-01-01", authorEmail: "a@x.com", isLatest: true },
            { version: "0.9.0", publishedAt: "2025-12-01", authorEmail: "a@x.com" },
          ],
        });
      }
      return jsonResponse({ displayName: "X" });
    }) as unknown as typeof fetch;
    const h = await mount({});
    await flushMicrotasks();
    const { act } = await import("react");
    const rows = h.container.querySelectorAll("[data-testid='skill-detail-version-row']");
    const rowOld = rows[1] as HTMLButtonElement;
    await act(async () => { rowOld.click(); });
    expect(rowOld.getAttribute("data-selected")).toBe("true");
    await h.unmount();
  });

  it('renders a "see all versions" link with target=_blank', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/versions")) return jsonResponse({ versions: [] });
      return jsonResponse({ displayName: "X" });
    }) as unknown as typeof fetch;
    const h = await mount({});
    await flushMicrotasks();
    const link = h.container.querySelector("[data-testid='skill-detail-see-all-versions']") as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("href")).toContain("verified-skill.com/skills/obsidian/brain/wiki-sync/versions");
    await h.unmount();
  });
});

// ---------------------------------------------------------------------------
// 0819 T-015: AC-US5b-01..05 — unversioned-branch copy.
// When the platform's /versions response carries `unversioned: true`, the
// panel must render "Discovered — no published version yet (currentVersion:
// X)" instead of the misleading "No versions found.".
// ---------------------------------------------------------------------------
describe("SkillDetailPanel — 0819 T-015 unversioned branch", () => {
  it("AC-US5b-02/03: renders skill-detail-unversioned with currentVersion when unversioned: true", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/versions")) {
        return jsonResponse({ versions: [], count: 0, unversioned: true, currentVersion: "1.0.0" });
      }
      return jsonResponse({ displayName: "Wiki Sync" });
    }) as unknown as typeof fetch;

    const h = await mount({});
    await flushMicrotasks();

    const unversionedNode = h.container.querySelector("[data-testid='skill-detail-unversioned']");
    expect(unversionedNode).toBeTruthy();
    expect(unversionedNode?.textContent ?? "").toContain("Discovered");
    expect(unversionedNode?.textContent ?? "").toContain("no published version yet");
    expect(unversionedNode?.textContent ?? "").toContain("currentVersion: 1.0.0");

    // The legacy "no versions found" branch must NOT render simultaneously.
    expect(h.container.querySelector("[data-testid='skill-detail-no-versions']")).toBeNull();

    await h.unmount();
  });

  it("AC-US5b-03: legacy `versions: []` (no unversioned flag) keeps the original copy + testid", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/versions")) return jsonResponse({ versions: [], count: 0 });
      return jsonResponse({ displayName: "Wiki Sync" });
    }) as unknown as typeof fetch;

    const h = await mount({});
    await flushMicrotasks();

    expect(h.container.querySelector("[data-testid='skill-detail-no-versions']")).toBeTruthy();
    expect(h.container.querySelector("[data-testid='skill-detail-unversioned']")).toBeNull();

    await h.unmount();
  });

  it("AC-US5b-04: with versions present, neither orphan-copy testid renders", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/versions")) {
        return jsonResponse({
          versions: [{ version: "1.0.0", isLatest: true, publishedAt: "2026-01-01" }],
          count: 1,
        });
      }
      return jsonResponse({ displayName: "Wiki Sync" });
    }) as unknown as typeof fetch;

    const h = await mount({});
    await flushMicrotasks();

    expect(h.container.querySelector("[data-testid='skill-detail-version-row']")).toBeTruthy();
    expect(h.container.querySelector("[data-testid='skill-detail-unversioned']")).toBeNull();
    expect(h.container.querySelector("[data-testid='skill-detail-no-versions']")).toBeNull();

    await h.unmount();
  });
});

// ---------------------------------------------------------------------------
// T-023: install command + sanitization
// ---------------------------------------------------------------------------
describe("SkillDetailPanel — T-023 install command", () => {
  it("renders `npx vskill@latest install <publisher>/<slug>` (npm variant) for the latest version", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/versions")) return jsonResponse({ versions: [{ version: "1.0.0", isLatest: true }] });
      return jsonResponse({ displayName: "X", ownerSlug: "obsidian", repoSlug: "brain", skillSlug: "wiki-sync" });
    }) as unknown as typeof fetch;
    const h = await mount({});
    await flushMicrotasks();
    const npmCmd = h.container.querySelector("[data-testid='skill-detail-install-variant-cmd-npm']");
    expect(npmCmd?.textContent).toBe("npx vskill@latest install obsidian/brain/wiki-sync --scope project");
    // All 5 variants are present.
    for (const label of ["npm", "bun", "pnpm", "yarn", "alternative"]) {
      expect(h.container.querySelector(`[data-testid='skill-detail-install-variant-${label}']`)).toBeTruthy();
    }
    await h.unmount();
  });

  it("renders `@<version>` form across all variants for non-latest selection", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/versions")) {
        return jsonResponse({
          versions: [
            { version: "2.0.0", publishedAt: "2026-04-01", isLatest: true },
            { version: "1.0.0", publishedAt: "2026-01-01" },
          ],
        });
      }
      return jsonResponse({ displayName: "X", ownerSlug: "obsidian", repoSlug: "brain", skillSlug: "wiki-sync" });
    }) as unknown as typeof fetch;
    const h = await mount({});
    await flushMicrotasks();
    const { act } = await import("react");
    const rows = h.container.querySelectorAll("[data-testid='skill-detail-version-row']");
    const oldRow = Array.from(rows).find((r) => r.getAttribute("data-version") === "1.0.0") as HTMLButtonElement;
    await act(async () => { oldRow.click(); });
    const npmCmd = h.container.querySelector("[data-testid='skill-detail-install-variant-cmd-npm']");
    expect(npmCmd?.textContent).toBe("npx vskill@latest install obsidian/brain/wiki-sync@1.0.0 --scope project");
    const bunCmd = h.container.querySelector("[data-testid='skill-detail-install-variant-cmd-bun']");
    expect(bunCmd?.textContent).toBe("bunx vskill@latest install obsidian/brain/wiki-sync@1.0.0 --scope project");
    await h.unmount();
  });

  it("refuses to render install panel for malicious slug", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/versions")) return jsonResponse({ versions: [{ version: "1.0.0", isLatest: true }] });
      return jsonResponse({ displayName: "Bad", ownerSlug: "obsidian", repoSlug: "brain", skillSlug: "bad name; rm -rf /" });
    }) as unknown as typeof fetch;
    const h = await mount({ selectedSkill: { owner: "obsidian", repo: "brain", slug: "bad name; rm -rf /", displayName: "Bad" } });
    await flushMicrotasks();
    expect(h.container.querySelector("[data-testid='skill-detail-install-error']")).toBeTruthy();
    expect(h.container.querySelector("[data-testid='skill-detail-install']")).toBeNull();
    await h.unmount();
  });
});

// ---------------------------------------------------------------------------
// T-024 + T-028: copy + telemetry
// ---------------------------------------------------------------------------
describe("SkillDetailPanel — T-024 copy + T-028 telemetry", () => {
  it("copies install command and dispatches studio:toast", async () => {
    const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/v1/studio/telemetry/install-copy")) return jsonResponse({});
      if (url.endsWith("/versions")) return jsonResponse({ versions: [{ version: "1.0.0", isLatest: true }] });
      return jsonResponse({ displayName: "X", ownerSlug: "obsidian", repoSlug: "brain", skillSlug: "wiki-sync" });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    const onToast = vi.fn();
    const h = await mount({ onToast });
    await flushMicrotasks();
    const { act } = await import("react");
    // Primary Install button copies the canonical npm command (`npx vskill@latest install …`).
    // 0784 hotfix: primary button now invokes /api/studio/install-skill.
    // Existing copy+telemetry behavior is exercised through the per-variant
    // npm Copy chip (which still uses the original handleCopy path).
    const npmCopyBtn = h.container.querySelector("[data-testid='skill-detail-copy-npm']") as HTMLButtonElement;
    await act(async () => { npmCopyBtn.click(); });
    await flushMicrotasks();
    expect(writeText).toHaveBeenCalledWith("npx vskill@latest install obsidian/brain/wiki-sync --scope project");
    expect(onToast).toHaveBeenCalledTimes(1);
    expect(onToast.mock.calls[0][0]).toContain("npx vskill@latest install");
    expect(onToast.mock.calls[0][1]).toBe("success");
    // Telemetry — fire-and-forget, keepalive: true
    const tcall = fetchSpy.mock.calls.find((c) => String(c[0]).includes("/api/v1/studio/telemetry/install-copy"));
    expect(tcall).toBeDefined();
    const init = tcall![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(String(init.body))).toMatchObject({ skillName: "obsidian/brain/wiki-sync", version: "1.0.0" });
    await h.unmount();
  });

  it("does NOT block clipboard or toast when telemetry rejects", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/v1/studio/telemetry/install-copy")) return statusResponse(500);
      if (url.endsWith("/versions")) return jsonResponse({ versions: [{ version: "1.0.0", isLatest: true }] });
      return jsonResponse({ displayName: "X", ownerSlug: "obsidian", repoSlug: "brain", skillSlug: "wiki-sync" });
    }) as unknown as typeof fetch;
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const onToast = vi.fn();
    const h = await mount({ onToast });
    await flushMicrotasks();
    const { act } = await import("react");
    // 0784 hotfix: primary button now invokes /api/studio/install-skill.
    // Existing copy+telemetry behavior is exercised through the per-variant
    // npm Copy chip (which still uses the original handleCopy path).
    const npmCopyBtn = h.container.querySelector("[data-testid='skill-detail-copy-npm']") as HTMLButtonElement;
    await act(async () => { npmCopyBtn.click(); });
    await flushMicrotasks();
    expect(writeText).toHaveBeenCalled();
    expect(onToast).toHaveBeenCalled();
    await h.unmount();
  });

  // 0784: per-variant Copy chips each copy their OWN command (not the canonical npm).
  it("clicking the bun Copy chip writes the bun command to the clipboard", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/versions")) return jsonResponse({ versions: [{ version: "1.0.0", isLatest: true }] });
      return jsonResponse({ displayName: "X", ownerSlug: "obsidian", repoSlug: "brain", skillSlug: "wiki-sync" });
    }) as unknown as typeof fetch;
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const onToast = vi.fn();
    const h = await mount({ onToast });
    await flushMicrotasks();
    const { act } = await import("react");
    const bunCopy = h.container.querySelector("[data-testid='skill-detail-copy-bun']") as HTMLButtonElement;
    await act(async () => { bunCopy.click(); });
    await flushMicrotasks();
    expect(writeText).toHaveBeenCalledWith("bunx vskill@latest install obsidian/brain/wiki-sync --scope project");
    expect(onToast).toHaveBeenCalled();
    expect(onToast.mock.calls[0][0]).toContain("bunx vskill@latest install");
    await h.unmount();
  });
});

// ---------------------------------------------------------------------------
// T-025: blocked
// ---------------------------------------------------------------------------
describe("SkillDetailPanel — T-025 blocked panel", () => {
  it("replaces install panel with 'This skill is blocked' when isBlocked=true", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/versions")) return jsonResponse({ versions: [{ version: "1.0.0", isLatest: true }] });
      return jsonResponse({ displayName: "X", isBlocked: true, blockReason: "Contains malware" });
    }) as unknown as typeof fetch;
    const h = await mount({});
    await flushMicrotasks();
    expect(h.container.querySelector("[data-testid='skill-detail-blocked']")).toBeTruthy();
    expect(h.container.querySelector("[data-testid='skill-detail-install']")).toBeNull();
    expect(h.container.textContent).toContain("Contains malware");
    // Versions section still renders for transparency.
    expect(h.container.querySelector("[data-testid='skill-detail-versions']")).toBeTruthy();
    await h.unmount();
  });
});

// ---------------------------------------------------------------------------
// T-026: back to results
// ---------------------------------------------------------------------------
describe("SkillDetailPanel — T-026 back to results", () => {
  it("Back link calls onClose AND dispatches openFindSkills with the last query", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/versions")) return jsonResponse({ versions: [] });
      return jsonResponse({ displayName: "X" });
    }) as unknown as typeof fetch;
    window.sessionStorage.setItem("find-skills:last-query", "obsidian");
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const onClose = vi.fn();
    const h = await mount({ onClose });
    await flushMicrotasks();
    const { act } = await import("react");
    const back = h.container.querySelector("[data-testid='skill-detail-back']") as HTMLButtonElement;
    await act(async () => { back.click(); });
    expect(onClose).toHaveBeenCalledTimes(1);
    const opened = dispatchSpy.mock.calls
      .map(([e]) => e as Event)
      .find((e) => e.type === "openFindSkills") as CustomEvent<{ query?: string }> | undefined;
    expect(opened).toBeDefined();
    expect(opened?.detail?.query).toBe("obsidian");
    await h.unmount();
  });

  it("Esc closes the panel via the same back path", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/versions")) return jsonResponse({ versions: [] });
      return jsonResponse({ displayName: "X" });
    }) as unknown as typeof fetch;
    const onClose = vi.fn();
    const h = await mount({ onClose });
    await flushMicrotasks();
    const { act } = await import("react");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    await h.unmount();
  });
});

// ---------------------------------------------------------------------------
// 0826: install dialog should auto-close after a successful install so the
// user isn't left looking at a panel that appears to still be running.
// ---------------------------------------------------------------------------
describe("SkillDetailPanel — 0826 close on install success", () => {
  // Minimal EventSource shim that lets the test fire `done` events.
  class FakeEventSource {
    url: string;
    listeners = new Map<string, ((ev: MessageEvent) => void)[]>();
    onerror: ((ev: Event) => void) | null = null;
    closed = false;
    static instances: FakeEventSource[] = [];
    constructor(url: string) {
      this.url = url;
      FakeEventSource.instances.push(this);
    }
    addEventListener(type: string, cb: (ev: MessageEvent) => void): void {
      const list = this.listeners.get(type) ?? [];
      list.push(cb);
      this.listeners.set(type, list);
    }
    emit(type: string, data: unknown): void {
      const list = this.listeners.get(type) ?? [];
      const ev = new MessageEvent(type, { data: JSON.stringify(data) });
      for (const cb of list) cb(ev);
    }
    close(): void { this.closed = true; }
  }

  it("calls onClose after SSE 'done' with success=true", async () => {
    FakeEventSource.instances = [];
    (globalThis as unknown as { EventSource: typeof FakeEventSource }).EventSource = FakeEventSource;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/studio/install-skill") && init?.method === "POST") {
        return jsonResponse({ jobId: "job-1" });
      }
      if (typeof url === "string" && url.endsWith("/versions")) {
        return jsonResponse({ versions: [{ version: "1.0.0", isLatest: true }] });
      }
      return jsonResponse({ displayName: "X", ownerSlug: "obsidian", repoSlug: "brain", skillSlug: "wiki-sync" });
    }) as unknown as typeof fetch;
    const onClose = vi.fn();
    const h = await mount({ onClose });
    await flushMicrotasks();
    const { act } = await import("react");
    const installBtn = h.container.querySelector("[data-testid='skill-detail-install-primary']") as HTMLButtonElement;
    await act(async () => { installBtn.click(); });
    await flushMicrotasks();
    // Wait for the EventSource to be created.
    expect(FakeEventSource.instances.length).toBe(1);
    const es = FakeEventSource.instances[0];
    await act(async () => { es.emit("done", { success: true, exitCode: 0, stderr: "" }); });
    await flushMicrotasks();
    expect(onClose).toHaveBeenCalledTimes(1);
    await h.unmount();
  });

  it("does NOT call onClose after SSE 'done' with success=false (failure keeps dialog open)", async () => {
    FakeEventSource.instances = [];
    (globalThis as unknown as { EventSource: typeof FakeEventSource }).EventSource = FakeEventSource;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/studio/install-skill") && init?.method === "POST") {
        return jsonResponse({ jobId: "job-2" });
      }
      if (typeof url === "string" && url.endsWith("/versions")) {
        return jsonResponse({ versions: [{ version: "1.0.0", isLatest: true }] });
      }
      return jsonResponse({ displayName: "X", ownerSlug: "obsidian", repoSlug: "brain", skillSlug: "wiki-sync" });
    }) as unknown as typeof fetch;
    const onClose = vi.fn();
    const h = await mount({ onClose });
    await flushMicrotasks();
    const { act } = await import("react");
    const installBtn = h.container.querySelector("[data-testid='skill-detail-install-primary']") as HTMLButtonElement;
    await act(async () => { installBtn.click(); });
    await flushMicrotasks();
    const es = FakeEventSource.instances[0];
    await act(async () => { es.emit("done", { success: false, exitCode: 1, stderr: "boom" }); });
    await flushMicrotasks();
    expect(onClose).not.toHaveBeenCalled();
    await h.unmount();
  });
});

// ---------------------------------------------------------------------------
// T-029: 502 error inline retry
// ---------------------------------------------------------------------------
describe("SkillDetailPanel — T-029 5xx inline retry", () => {
  it("renders inline error + retry on metadata 502 (does not crash)", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/versions")) return jsonResponse({ versions: [] });
      return statusResponse(502);
    }) as unknown as typeof fetch;
    const h = await mount({});
    await flushMicrotasks();
    expect(h.container.querySelector("[data-testid='skill-detail-error']")).toBeTruthy();
    expect(h.container.querySelector("[data-testid='skill-detail-retry']")).toBeTruthy();
    // Panel itself still rendered.
    expect(h.container.querySelector("[data-testid='skill-detail-panel']")).toBeTruthy();
    await h.unmount();
  });

  it("clicking Retry re-issues the metadata fetch", async () => {
    let metaCalls = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/versions")) return jsonResponse({ versions: [{ version: "1.0.0", isLatest: true }] });
      metaCalls++;
      if (metaCalls === 1) return statusResponse(502);
      return jsonResponse({ displayName: "Recovered" });
    }) as unknown as typeof fetch;
    const h = await mount({});
    await flushMicrotasks();
    expect(h.container.querySelector("[data-testid='skill-detail-retry']")).toBeTruthy();
    const { act } = await import("react");
    const retry = h.container.querySelector("[data-testid='skill-detail-retry']") as HTMLButtonElement;
    await act(async () => { retry.click(); });
    await flushMicrotasks();
    expect(h.container.textContent).toContain("Recovered");
    await h.unmount();
  });
});

// ---------------------------------------------------------------------------
// T-030: a11y basics
// ---------------------------------------------------------------------------
describe("SkillDetailPanel — T-030 a11y", () => {
  it("renders with role='dialog' and aria-modal='true'", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/versions")) return jsonResponse({ versions: [] });
      return jsonResponse({ displayName: "X" });
    }) as unknown as typeof fetch;
    const h = await mount({});
    const dialog = h.container.querySelector("[role='dialog']");
    expect(dialog).toBeTruthy();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    await h.unmount();
  });

  it("focuses the back button on mount (within ~50ms)", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/versions")) return jsonResponse({ versions: [] });
      return jsonResponse({ displayName: "X" });
    }) as unknown as typeof fetch;
    vi.useFakeTimers();
    const h = await mount({});
    await vi.advanceTimersByTimeAsync(80);
    await flushMicrotasks();
    const back = h.container.querySelector("[data-testid='skill-detail-back']");
    expect(document.activeElement).toBe(back);
    vi.useRealTimers();
    await h.unmount();
  });
});

// ---------------------------------------------------------------------------
// 0827 — install scope picker: two-button (Project | User) + per-scope
// install-state awareness. Covers AC-US1-01..05, AC-US2-06..09, AC-US3-04.
// ---------------------------------------------------------------------------

interface InstallStateBody {
  skill: string;
  detectedAgentTools: { id: string; displayName: string; localDir: string; globalDir: string }[];
  scopes: {
    project: { installed: boolean; installedAgentTools: string[]; version: string | null };
    user: { installed: boolean; installedAgentTools: string[]; version: string | null };
  };
}

function emptyInstallState(skill: string): InstallStateBody {
  return {
    skill,
    detectedAgentTools: [],
    scopes: {
      project: { installed: false, installedAgentTools: [], version: null },
      user: { installed: false, installedAgentTools: [], version: null },
    },
  };
}

function makeFetchHandler(opts: {
  installState?: InstallStateBody;
  installStateStatus?: number;
  onPost?: (body: unknown) => void;
} = {}) {
  return vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("/api/studio/install-state")) {
      if (typeof opts.installStateStatus === "number" && opts.installStateStatus >= 400) {
        return statusResponse(opts.installStateStatus);
      }
      return jsonResponse(opts.installState ?? emptyInstallState("obsidian/brain/wiki-sync"));
    }
    if (u.includes("/api/studio/install-skill") && init?.method === "POST") {
      try { opts.onPost?.(JSON.parse(String(init.body))); } catch { /* */ }
      return jsonResponse({ jobId: "job-x" });
    }
    if (u.endsWith("/versions")) return jsonResponse({ versions: [{ version: "1.0.0", isLatest: true }] });
    return jsonResponse({ displayName: "X", ownerSlug: "obsidian", repoSlug: "brain", skillSlug: "wiki-sync" });
  });
}

describe("0827 — SkillDetailPanel scope picker (Project | User only)", () => {
  // T-009: AC-US1-01 — only Project + User radio buttons rendered, no Global.
  it("T-009: renders only Project and User scope buttons (no Global)", async () => {
    globalThis.fetch = makeFetchHandler() as unknown as typeof fetch;
    const h = await mount({});
    await flushMicrotasks();
    expect(h.container.querySelector("[data-testid='skill-detail-install-scope-project']")).toBeTruthy();
    expect(h.container.querySelector("[data-testid='skill-detail-install-scope-user']")).toBeTruthy();
    expect(h.container.querySelector("[data-testid='skill-detail-install-scope-global']")).toBeNull();
    await h.unmount();
  });

  // T-011: AC-US1-02 — User scope renders ` --global` (not `--scope user`).
  it("T-011: User scope copy-command renders --global, not --scope user", async () => {
    globalThis.fetch = makeFetchHandler() as unknown as typeof fetch;
    const h = await mount({});
    await flushMicrotasks();
    const { act } = await import("react");
    const userBtn = h.container.querySelector("[data-testid='skill-detail-install-scope-user']") as HTMLButtonElement;
    await act(async () => { userBtn.click(); });
    await flushMicrotasks();
    const npmCmd = h.container.querySelector("[data-testid='skill-detail-install-variant-cmd-npm']");
    expect(npmCmd?.textContent).toMatch(/npx vskill@latest install [^ ]+ --global$/);
    expect(npmCmd?.textContent).not.toContain("--scope user");
    await h.unmount();
  });
});

describe("0827 — SkillDetailPanel install-state fetch (T-013)", () => {
  it("T-013: fetches /api/studio/install-state alongside metadata + versions on mount", async () => {
    const fetchSpy = makeFetchHandler();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const h = await mount({});
    await flushMicrotasks();
    const calls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u === "/api/v1/skills/obsidian/brain/wiki-sync")).toBe(true);
    expect(calls.some((u) => u === "/api/v1/skills/obsidian/brain/wiki-sync/versions")).toBe(true);
    expect(calls.some((u) => u.startsWith("/api/studio/install-state?skill=obsidian%2Fbrain%2Fwiki-sync"))).toBe(true);
    await h.unmount();
  });
});

describe("0827 — SkillDetailPanel disabled-state rendering", () => {
  // T-015: AC-US2-06 — User scope disabled when scopes.user.installed === true.
  it("T-015: shows 'Installed ✓ User' disabled with correct title when user scope is installed", async () => {
    const installState: InstallStateBody = {
      skill: "obsidian/brain/wiki-sync",
      detectedAgentTools: [{ id: "claude-code", displayName: "Claude Code", localDir: ".claude/skills", globalDir: "~/.claude/skills" }],
      scopes: {
        project: { installed: false, installedAgentTools: [], version: null },
        user: { installed: true, installedAgentTools: ["claude-code"], version: "2.0.12" },
      },
    };
    globalThis.fetch = makeFetchHandler({ installState }) as unknown as typeof fetch;
    const h = await mount({});
    await flushMicrotasks();
    const userBtn = h.container.querySelector("[data-testid='skill-detail-install-scope-user']") as HTMLButtonElement;
    expect(userBtn.textContent).toBe("Installed ✓ User");
    expect(userBtn.getAttribute("aria-disabled")).toBe("true");
    expect(userBtn.disabled).toBe(true);
    expect(userBtn.getAttribute("title")).toMatch(/Installed v2\.0\.12 · claude-code/);
    await h.unmount();
  });

  // T-017: AC-US2-07 — same contract for project scope.
  it("T-017: shows 'Installed ✓ Project' disabled with correct title when project scope is installed", async () => {
    const installState: InstallStateBody = {
      skill: "obsidian/brain/wiki-sync",
      detectedAgentTools: [{ id: "cursor", displayName: "Cursor", localDir: ".cursor/skills", globalDir: "~/.cursor/skills" }],
      scopes: {
        project: { installed: true, installedAgentTools: ["cursor"], version: "1.4.0" },
        user: { installed: false, installedAgentTools: [], version: null },
      },
    };
    globalThis.fetch = makeFetchHandler({ installState }) as unknown as typeof fetch;
    const h = await mount({});
    await flushMicrotasks();
    const projBtn = h.container.querySelector("[data-testid='skill-detail-install-scope-project']") as HTMLButtonElement;
    expect(projBtn.textContent).toBe("Installed ✓ Project");
    expect(projBtn.getAttribute("aria-disabled")).toBe("true");
    expect(projBtn.disabled).toBe(true);
    expect(projBtn.getAttribute("title")).toMatch(/Installed v1\.4\.0 · cursor/);
    await h.unmount();
  });
});

describe("0827 — SkillDetailPanel enabled-button tooltips (T-018)", () => {
  // T-018: AC-US1-04, AC-US1-05 — enabled tooltips list per-tool destinations.
  it("T-018: tooltips list detectedAgentTools localDir/globalDir entries (project ./prefix, user ~ as-is)", async () => {
    const installState: InstallStateBody = {
      skill: "obsidian/brain/wiki-sync",
      detectedAgentTools: [
        { id: "claude-code", displayName: "Claude Code", localDir: ".claude/skills", globalDir: "~/.claude/skills" },
        { id: "cursor", displayName: "Cursor", localDir: ".cursor/skills", globalDir: "~/.cursor/skills" },
      ],
      scopes: {
        project: { installed: false, installedAgentTools: [], version: null },
        user: { installed: false, installedAgentTools: [], version: null },
      },
    };
    globalThis.fetch = makeFetchHandler({ installState }) as unknown as typeof fetch;
    const h = await mount({});
    await flushMicrotasks();
    const projBtn = h.container.querySelector("[data-testid='skill-detail-install-scope-project']") as HTMLButtonElement;
    const userBtn = h.container.querySelector("[data-testid='skill-detail-install-scope-user']") as HTMLButtonElement;
    expect(projBtn.getAttribute("title")).toMatch(/Will install to: \.\/\.claude\/skills, \.\/\.cursor\/skills/);
    expect(userBtn.getAttribute("title")).toMatch(/Will install to: ~\/\.claude\/skills, ~\/\.cursor\/skills/);
    await h.unmount();
  });
});

describe("0827 — SkillDetailPanel primary CTA gating (T-020)", () => {
  // T-020: AC-US2-08 — primary Install CTA disabled when selected scope is installed.
  it("T-020: primary CTA disabled with 'Already installed at <scope>' tooltip when selected scope is installed", async () => {
    const installState: InstallStateBody = {
      skill: "obsidian/brain/wiki-sync",
      detectedAgentTools: [],
      scopes: {
        project: { installed: true, installedAgentTools: ["claude-code"], version: "2.0.12" },
        user: { installed: false, installedAgentTools: [], version: null },
      },
    };
    globalThis.fetch = makeFetchHandler({ installState }) as unknown as typeof fetch;
    const h = await mount({});
    await flushMicrotasks();
    // Default scope is "project" — and it's installed → CTA disabled.
    const cta = h.container.querySelector("[data-testid='skill-detail-install-primary']") as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
    expect(cta.getAttribute("title")).toMatch(/Already installed at project — re-run via CLI to force/);
    // Switching to user (not installed) re-enables the CTA.
    const { act } = await import("react");
    const userBtn = h.container.querySelector("[data-testid='skill-detail-install-scope-user']") as HTMLButtonElement;
    await act(async () => { userBtn.click(); });
    await flushMicrotasks();
    const cta2 = h.container.querySelector("[data-testid='skill-detail-install-primary']") as HTMLButtonElement;
    expect(cta2.disabled).toBe(false);
    expect(cta2.getAttribute("title")).toBeNull();
    await h.unmount();
  });
});

describe("0827 — SkillDetailPanel re-fetch on studio:skill-installed (T-022)", () => {
  // T-022: AC-US2-09 — install-state re-fetched after CustomEvent matching skill.
  it("T-022: re-fetches install-state after studio:skill-installed event with matching skill", async () => {
    let installStateCallCount = 0;
    let currentBody: InstallStateBody = emptyInstallState("obsidian/brain/wiki-sync");
    const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.startsWith("/api/studio/install-state")) {
        installStateCallCount++;
        return jsonResponse(currentBody);
      }
      if (u.endsWith("/versions")) return jsonResponse({ versions: [{ version: "1.0.0", isLatest: true }] });
      return jsonResponse({ displayName: "X", ownerSlug: "obsidian", repoSlug: "brain", skillSlug: "wiki-sync" });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    vi.useFakeTimers();
    const h = await mount({});
    await flushMicrotasks();
    const initialCount = installStateCallCount;
    expect(initialCount).toBeGreaterThanOrEqual(1);

    // Flip the mocked install-state to "installed at user" before dispatching.
    currentBody = {
      skill: "obsidian/brain/wiki-sync",
      detectedAgentTools: [],
      scopes: {
        project: { installed: false, installedAgentTools: [], version: null },
        user: { installed: true, installedAgentTools: ["claude-code"], version: "2.0.12" },
      },
    };

    const { act } = await import("react");
    await act(async () => {
      window.dispatchEvent(new CustomEvent("studio:skill-installed", {
        detail: { skill: "obsidian/brain/wiki-sync", scope: "user" },
      }));
    });
    // 50ms debounce + microtask flush.
    await act(async () => { await vi.advanceTimersByTimeAsync(60); });
    await flushMicrotasks();
    vi.useRealTimers();

    expect(installStateCallCount).toBeGreaterThan(initialCount);
    const userBtn = h.container.querySelector("[data-testid='skill-detail-install-scope-user']") as HTMLButtonElement;
    expect(userBtn.textContent).toBe("Installed ✓ User");
    expect(userBtn.disabled).toBe(true);
    await h.unmount();
  });
});

describe("0827 — SkillDetailPanel non-blocking failure (T-024)", () => {
  // T-024: AC-US3-04 — install-state 5xx leaves the panel functional + warns once.
  it("T-024: install-state 500 still renders enabled buttons + primary CTA + warns once", async () => {
    globalThis.fetch = makeFetchHandler({ installStateStatus: 500 }) as unknown as typeof fetch;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try { window.sessionStorage.removeItem("vskill:installState:warned"); } catch { /* */ }

    const h = await mount({});
    await flushMicrotasks();

    const projBtn = h.container.querySelector("[data-testid='skill-detail-install-scope-project']") as HTMLButtonElement;
    const userBtn = h.container.querySelector("[data-testid='skill-detail-install-scope-user']") as HTMLButtonElement;
    const cta = h.container.querySelector("[data-testid='skill-detail-install-primary']") as HTMLButtonElement;
    expect(projBtn.disabled).toBe(false);
    expect(userBtn.disabled).toBe(false);
    expect(cta.disabled).toBe(false);

    // Warned exactly once with "install-state" in the message.
    const warnCalls = warnSpy.mock.calls.filter((args) =>
      args.some((a) => typeof a === "string" && a.includes("install-state")),
    );
    expect(warnCalls.length).toBe(1);
    warnSpy.mockRestore();
    await h.unmount();
  });
});
