// @vitest-environment jsdom
// 0839 T-012 — TenantPicker contract tests.
//
// AC coverage:
//   AC-US4-01 — N≥2 renders a dropdown with all tenants
//   AC-US4-02 — On mount, fetches tenant list + active slug
//   AC-US4-03 — Selecting a row POSTs to /__internal/active-tenant
//   AC-US4-04 — N=0 renders the children slot (Connect-GitHub CTA passthrough)
//   AC-US4-05 — N=1 renders a static label, no dropdown
//   AC-US4-06 — onTenantChange fires after a successful switch (so callers
//               can invalidate caches and re-issue with X-Vskill-Tenant)
//
// Tests use two render strategies:
//   • renderToStaticMarkup — for synchronous shape assertions where the
//     `initialTenants` prop is supplied (no fetch lifecycle to wait for).
//     Mirrors the pattern used by PrivateOrgSection.test.tsx and
//     ProjectPicker.test.tsx already in this codebase.
//   • createRoot + act — for the fetch + select interaction tests, where
//     hooks fire and the useEffect-driven `apiImpl.getAccountTenants()`
//     call needs to settle before assertions run.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { TenantPicker } from "../TenantPicker";
import type { TenantSummary } from "../../../api";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const acme: TenantSummary = {
  tenantId: "t_acme",
  slug: "acme",
  name: "Acme Corp",
  role: "owner",
  installationId: "11",
};
const contoso: TenantSummary = {
  tenantId: "t_contoso",
  slug: "contoso",
  name: "Contoso",
  role: "member",
  installationId: "22",
};
const globex: TenantSummary = {
  tenantId: "t_globex",
  slug: "globex",
  name: "Globex",
  role: "admin",
  installationId: "33",
};

describe("TenantPicker — static render shapes", () => {
  it("N=0 renders the children slot (AC-US4-04)", () => {
    const html = renderToStaticMarkup(
      <TenantPicker initialTenants={[]} initialActiveSlug={null}>
        <button data-testid="connect-cta">Connect GitHub</button>
      </TenantPicker>,
    );
    expect(html).toContain('data-testid="connect-cta"');
    expect(html).not.toContain("data-tenant-picker=");
  });

  it("N=1 renders a static label, no dropdown (AC-US4-05)", () => {
    const html = renderToStaticMarkup(
      <TenantPicker initialTenants={[acme]} initialActiveSlug="acme" />,
    );
    expect(html).toContain('data-tenant-picker="single"');
    expect(html).toContain('data-tenant-slug="acme"');
    expect(html).toContain("Acme Corp");
    expect(html).not.toContain("<select");
  });

  it("N=3 renders a dropdown with every tenant (AC-US4-01)", () => {
    const html = renderToStaticMarkup(
      <TenantPicker
        initialTenants={[acme, contoso, globex]}
        initialActiveSlug="acme"
      />,
    );
    expect(html).toContain('data-tenant-picker="dropdown"');
    expect(html).toMatch(/<select[^>]*data-tenant-picker-select/);
    expect(html).toContain("Acme Corp");
    expect(html).toContain("Contoso");
    expect(html).toContain("Globex");
    // Active option should be selected — react-dom/server emits selected="" for the matching <option>.
    expect(html).toMatch(/value="acme"[^>]*selected/);
  });

  it("N≥2 with no active slug shows the placeholder option", () => {
    const html = renderToStaticMarkup(
      <TenantPicker
        initialTenants={[acme, contoso]}
        initialActiveSlug={null}
      />,
    );
    expect(html).toContain("Select a tenant");
  });
});

// ---------------------------------------------------------------------------
// Interactive tests — exercise the fetch lifecycle + selection callback.
// ---------------------------------------------------------------------------

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

function makeApiMock(tenants: TenantSummary[], activeSlug: string | null = null) {
  const setActiveTenant = vi.fn(async (slug: string | null) => ({
    currentTenant: slug,
  }));
  return {
    getAccountTenants: vi.fn(async () => ({ tenants })),
    getActiveTenant: vi.fn(async () => ({ currentTenant: activeSlug })),
    setActiveTenant,
  };
}

async function flush() {
  // Two microtask flushes — first resolves Promise.all in the effect,
  // second propagates the resulting setState through React's scheduler.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("TenantPicker — fetch + selection", () => {
  it("fetches tenants + active slug on mount (AC-US4-02)", async () => {
    const apiImpl = makeApiMock([acme, contoso], "acme");
    await act(async () => {
      root!.render(<TenantPicker apiImpl={apiImpl} />);
    });
    await flush();

    expect(apiImpl.getAccountTenants).toHaveBeenCalledTimes(1);
    expect(apiImpl.getActiveTenant).toHaveBeenCalledTimes(1);
    expect(container!.innerHTML).toContain('data-tenant-picker="dropdown"');
    expect(container!.innerHTML).toContain("Acme Corp");
  });

  it("falls back to children when getAccountTenants fails (AC-US4-04 anonymous path)", async () => {
    const apiImpl = {
      getAccountTenants: vi.fn(async () => {
        throw new Error("401 Unauthorized");
      }),
      getActiveTenant: vi.fn(async () => ({ currentTenant: null })),
      setActiveTenant: vi.fn(),
    };
    await act(async () => {
      root!.render(
        <TenantPicker apiImpl={apiImpl}>
          <span data-testid="empty-state-cta">Connect</span>
        </TenantPicker>,
      );
    });
    await flush();
    expect(container!.innerHTML).toContain('data-testid="empty-state-cta"');
    expect(container!.innerHTML).not.toContain("data-tenant-picker=");
  });

  it("selecting a tenant POSTs to setActiveTenant + fires onTenantChange (AC-US4-03, AC-US4-06)", async () => {
    const apiImpl = makeApiMock([acme, contoso], "acme");
    const onTenantChange = vi.fn();
    await act(async () => {
      root!.render(
        <TenantPicker apiImpl={apiImpl} onTenantChange={onTenantChange} />,
      );
    });
    await flush();

    const select = container!.querySelector(
      "select[data-tenant-picker-select]",
    ) as HTMLSelectElement | null;
    expect(select).not.toBeNull();

    await act(async () => {
      select!.value = "contoso";
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();

    expect(apiImpl.setActiveTenant).toHaveBeenCalledTimes(1);
    expect(apiImpl.setActiveTenant).toHaveBeenCalledWith("contoso");
    expect(onTenantChange).toHaveBeenCalledTimes(1);
    expect(onTenantChange).toHaveBeenCalledWith("contoso");
  });

  // 0839 F-005 — debounce window-focus storms.
  it("F-005: rapid window 'focus' events within the debounce window are dropped", async () => {
    const apiImpl = makeApiMock([acme, contoso], "acme");
    await act(async () => {
      root!.render(<TenantPicker apiImpl={apiImpl} />);
    });
    await flush();

    // Initial mount fetch sets lastFetchAt — subsequent focus events
    // within FOCUS_REFETCH_DEBOUNCE_MS (1000ms) of the mount fetch
    // should be dropped without making any additional API calls.
    expect(apiImpl.getAccountTenants).toHaveBeenCalledTimes(1);

    // Two synthetic focus events back-to-back — both inside the debounce.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await flush();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await flush();

    // Both focus events were dropped — only the mount fetch happened.
    expect(apiImpl.getAccountTenants).toHaveBeenCalledTimes(1);
    expect(apiImpl.getActiveTenant).toHaveBeenCalledTimes(1);
  });

  it("F-005: focus events after the debounce window do refetch", async () => {
    const apiImpl = makeApiMock([acme, contoso], "acme");
    await act(async () => {
      root!.render(<TenantPicker apiImpl={apiImpl} />);
    });
    await flush();

    expect(apiImpl.getAccountTenants).toHaveBeenCalledTimes(1);

    // Use vi.useFakeTimers + Date.now spy to advance past the debounce.
    const realNow = Date.now;
    let nowOffset = 0;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + nowOffset);

    // Advance past the 1s debounce window.
    nowOffset += 2_000;

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await flush();

    // Now we should have refetched.
    expect(apiImpl.getAccountTenants).toHaveBeenCalledTimes(2);
  });

  it("selecting the already-active slug is a no-op", async () => {
    const apiImpl = makeApiMock([acme, contoso], "acme");
    await act(async () => {
      root!.render(<TenantPicker apiImpl={apiImpl} />);
    });
    await flush();

    const select = container!.querySelector(
      "select[data-tenant-picker-select]",
    ) as HTMLSelectElement | null;
    expect(select).not.toBeNull();

    await act(async () => {
      // change-event fires even when value is unchanged in some test envs;
      // re-dispatching the active value should not POST.
      select!.value = "acme";
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();

    expect(apiImpl.setActiveTenant).not.toHaveBeenCalled();
  });
});
