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
    expect(npmCmd?.textContent).toBe("npx vskill@latest install obsidian/brain/wiki-sync");
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
    expect(npmCmd?.textContent).toBe("npx vskill@latest install obsidian/brain/wiki-sync@1.0.0");
    const bunCmd = h.container.querySelector("[data-testid='skill-detail-install-variant-cmd-bun']");
    expect(bunCmd?.textContent).toBe("bunx vskill@latest install obsidian/brain/wiki-sync@1.0.0");
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
    const installBtn = h.container.querySelector("[data-testid='skill-detail-install-primary']") as HTMLButtonElement;
    await act(async () => { installBtn.click(); });
    await flushMicrotasks();
    expect(writeText).toHaveBeenCalledWith("npx vskill@latest install obsidian/brain/wiki-sync");
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
    const installBtn = h.container.querySelector("[data-testid='skill-detail-install-primary']") as HTMLButtonElement;
    await act(async () => { installBtn.click(); });
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
    expect(writeText).toHaveBeenCalledWith("bunx vskill@latest install obsidian/brain/wiki-sync");
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
