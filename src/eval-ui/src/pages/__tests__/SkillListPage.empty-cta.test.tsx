// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0699: homepage Create-Skill CTA — empty-state card.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
global.fetch = mockFetch as typeof fetch;

function okJson<T>(data: T): Response {
  return { ok: true, status: 200, json: async () => data } as unknown as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
});

async function waitFor(pred: () => boolean, timeout = 500): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < timeout) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("SkillListPage empty-state CTA (0699)", () => {
  it("renders prominent 'Create Your First Skill' card when zero skills are returned", async () => {
    mockFetch.mockResolvedValueOnce(okJson([]));

    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { MemoryRouter } = await import("react-router-dom");
    const { SkillListPage } = await import("../SkillListPage");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(SkillListPage),
        ),
      );
    });

    await waitFor(() => container.textContent?.includes("Create Your First Skill") ?? false);

    expect(container.textContent).toContain("Create Your First Skill");
    // Link points at /create (same route as the in-header "New Skill" button);
    // there may be multiple anchors to /create — we want the empty-state one.
    const ctas = container.querySelectorAll('a[href="/create"]');
    expect(ctas.length).toBeGreaterThanOrEqual(1);
    const emptyStateCta = Array.from(ctas).find((el) =>
      (el.textContent ?? "").includes("Create Your First Skill"),
    );
    expect(emptyStateCta).toBeDefined();
    // Also confirm the test hook is present on the wrapper card
    expect(container.querySelector('[data-testid="skill-list-empty-cta"]')).not.toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it("does NOT render the empty-state card when skills exist", async () => {
    mockFetch.mockResolvedValueOnce(
      okJson([
        {
          plugin: "x",
          skill: "y",
          dir: "/d",
          hasEvals: false,
          hasBenchmark: false,
          evalCount: 0,
          assertionCount: 0,
          benchmarkStatus: "missing",
          lastBenchmark: null,
          origin: "source",
          scope: "own",
        },
      ]),
    );

    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { MemoryRouter } = await import("react-router-dom");
    const { SkillListPage } = await import("../SkillListPage");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(SkillListPage),
        ),
      );
    });

    await waitFor(() => container.textContent?.includes("y") ?? false);

    // CTA absent when skills exist — the smaller top-right "New Skill" is enough
    expect(container.textContent).not.toContain("Create Your First Skill");

    act(() => root.unmount());
    container.remove();
  });
});
