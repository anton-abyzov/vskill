// @vitest-environment jsdom
// 0839 T-013 — ConnectGitHubCard contract tests covering the new
// `tenant-picker` integration mode + regression coverage of the three
// pre-existing states.
//
// AC coverage:
//   AC-US4-01 — N≥1 tenants → ConnectGitHubCard renders <TenantPicker />
//   AC-US4-04 — N=0 tenants → existing "Install GitHub App" CTA renders
//   (no regression) — `no-auth` still emits the "Run vskill auth login"
//   button, `add-another` still emits the compact link.
//
// SSR via `renderToStaticMarkup` is sufficient: TenantPicker honors its
// `initialTenants` escape hatch in unit tests indirectly here by
// short-circuiting through a mocked `api` (we don't need the picker's
// dynamic branch — only that ConnectGitHubCard actually mounts it under
// the new `tenant-picker` state).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { ConnectGitHubCard } from "../ConnectGitHubCard";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Mock the api surface so TenantPicker's mount-time fetch doesn't hit
// the network. We control the resolved tenants per test by overriding
// the mock implementation.
vi.mock("../../../api", () => {
  const tenants: { tenants: Array<{ tenantId: string; slug: string; name: string; role: string; installationId: string }> } = {
    tenants: [],
  };
  const active: { currentTenant: string | null } = { currentTenant: null };
  return {
    api: {
      getAccountTenants: vi.fn(async () => tenants),
      getActiveTenant: vi.fn(async () => active),
      setActiveTenant: vi.fn(async (slug: string | null) => ({ currentTenant: slug })),
    },
    // Re-export the type so the component compiles. Vitest hoist injects
    // this module as a fresh stub — exporting an empty type via a fake
    // namespace is enough since we only use `import type`.
    __setTenants: (next: typeof tenants.tenants) => {
      tenants.tenants = next;
    },
    __setActive: (next: string | null) => {
      active.currentTenant = next;
    },
  };
});

describe("ConnectGitHubCard — pre-existing states (regression)", () => {
  it("state='no-auth' renders the 'Run vskill auth login' CTA", () => {
    const html = renderToStaticMarkup(
      <ConnectGitHubCard state="no-auth" />,
    );
    expect(html).toMatch(/data-state="no-auth"/);
    expect(html).toMatch(/Connect your GitHub org/);
    expect(html).toMatch(/vskill auth login/i);
  });

  it("state='no-installations' renders the install-app CTA (AC-US4-04 fallback path)", () => {
    const html = renderToStaticMarkup(
      <ConnectGitHubCard state="no-installations" />,
    );
    expect(html).toMatch(/data-state="no-installations"/);
    expect(html).toMatch(/No orgs have installed/);
  });

  it("state='add-another' renders the compact connect-link (no body)", () => {
    const html = renderToStaticMarkup(
      <ConnectGitHubCard state="add-another" />,
    );
    expect(html).toMatch(/data-state="add-another"/);
    expect(html).toMatch(/Connect another org/);
  });

  it("clicking the CTA calls onConnect", async () => {
    const onConnect = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<ConnectGitHubCard state="no-auth" onConnect={onConnect} />);
    });
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    button!.click();
    expect(onConnect).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    container.remove();
  });
});

// ---------------------------------------------------------------------------
// 0839 T-013 — new `tenant-picker` state.
// ---------------------------------------------------------------------------

describe("ConnectGitHubCard — tenant-picker integration (AC-US4-01, AC-US4-04)", () => {
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
  });

  it("state='tenant-picker' wraps in the new container with TenantPicker mounted", async () => {
    const apiMod = (await import("../../../api")) as unknown as {
      __setTenants: (next: Array<{ tenantId: string; slug: string; name: string; role: string; installationId: string }>) => void;
      __setActive: (next: string | null) => void;
    };
    apiMod.__setTenants([
      { tenantId: "t1", slug: "acme", name: "Acme Corp", role: "owner", installationId: "11" },
      { tenantId: "t2", slug: "contoso", name: "Contoso", role: "member", installationId: "22" },
    ]);
    apiMod.__setActive("acme");

    await act(async () => {
      root!.render(<ConnectGitHubCard state="tenant-picker" />);
    });
    // Let the TenantPicker's fetch + state propagation settle.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Outer wrapper should still carry the data-cta attribute that the
    // surrounding sidebar uses for analytics/hooks.
    expect(container!.innerHTML).toMatch(/data-cta="connect-github"/);
    expect(container!.innerHTML).toMatch(/data-state="tenant-picker"/);
    // The dropdown variant of TenantPicker should be in the DOM.
    expect(container!.innerHTML).toMatch(/data-tenant-picker="dropdown"/);
    expect(container!.innerHTML).toContain("Acme Corp");
    expect(container!.innerHTML).toContain("Contoso");
  });

  it("state='tenant-picker' with N=0 tenants renders the no-installations CTA (AC-US4-04)", async () => {
    const apiMod = (await import("../../../api")) as unknown as {
      __setTenants: (next: Array<{ tenantId: string; slug: string; name: string; role: string; installationId: string }>) => void;
      __setActive: (next: string | null) => void;
    };
    apiMod.__setTenants([]);
    apiMod.__setActive(null);

    await act(async () => {
      root!.render(<ConnectGitHubCard state="tenant-picker" />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // TenantPicker hands back the children slot, which in this wiring
    // is the existing 'no-installations' card.
    expect(container!.innerHTML).toMatch(/data-state="no-installations"/);
    expect(container!.innerHTML).toMatch(/No orgs have installed/);
  });

  it("forwards onTenantChange from props through to TenantPicker", async () => {
    const apiMod = (await import("../../../api")) as unknown as {
      __setTenants: (next: Array<{ tenantId: string; slug: string; name: string; role: string; installationId: string }>) => void;
      __setActive: (next: string | null) => void;
    };
    apiMod.__setTenants([
      { tenantId: "t1", slug: "acme", name: "Acme Corp", role: "owner", installationId: "11" },
      { tenantId: "t2", slug: "contoso", name: "Contoso", role: "member", installationId: "22" },
    ]);
    apiMod.__setActive("acme");

    const onTenantChange = vi.fn();
    await act(async () => {
      root!.render(
        <ConnectGitHubCard state="tenant-picker" onTenantChange={onTenantChange} />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const select = container!.querySelector(
      "select[data-tenant-picker-select]",
    ) as HTMLSelectElement | null;
    expect(select).not.toBeNull();

    await act(async () => {
      select!.value = "contoso";
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onTenantChange).toHaveBeenCalledWith("contoso");
  });
});
