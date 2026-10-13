// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePublishTenant, type PublishTenantSelection } from "../usePublishTenant";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mock = vi.hoisted(() => ({ list: vi.fn(), active: vi.fn(), select: vi.fn(), open: true }));
vi.mock("../../api", () => ({ api: { getAccountTenants: mock.list, getActiveTenant: mock.active, setActiveTenant: mock.select } }));
vi.mock("../../hosted-publishing", () => ({ get HOSTED_PRIVATE_PUBLISHING_AVAILABLE() { return mock.open; } }));
const tenants = [
  { tenantId: "id-1", slug: "one", name: "One", installationId: "42", role: "owner" },
  { tenantId: "id-2", slug: "two", name: "Two", installationId: "43", role: "admin" },
];
let root: Root;
let host: HTMLDivElement;
let value: PublishTenantSelection;
function Probe() { value = usePublishTenant(); return null; }
async function mount() { await act(async () => { root.render(<Probe />); }); }
beforeEach(() => {
  vi.clearAllMocks(); mock.open = true;
  mock.list.mockResolvedValue({ tenants });
  mock.active.mockResolvedValue({ currentTenant: "two" });
  mock.select.mockImplementation(async (slug) => ({ currentTenant: slug }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("0896 authoritative publishing account", () => {
  it("resolves a saved slug into its actual tenant ID", async () => {
    await mount();
    expect(value.tenantId).toBe("id-2");
    expect(mock.list).toHaveBeenCalledOnce();
  });
  it("never guesses between several accounts when the saved slug is stale", async () => {
    mock.active.mockResolvedValue({ currentTenant: "removed" });
    await mount();
    expect(value.tenantId).toBeUndefined();
  });
  it("selects the only connected account without requiring a saved preference", async () => {
    mock.list.mockResolvedValue({ tenants: [tenants[0]] });
    mock.active.mockResolvedValue({ currentTenant: null });
    await mount(); expect(value.tenantId).toBe("id-1");
  });
  it("selection persists the slug then refreshes to the corresponding ID", async () => {
    await mount(); mock.active.mockResolvedValue({ currentTenant: "one" });
    await act(async () => { await value.select("id-1"); });
    expect(mock.select).toHaveBeenCalledWith("one");
    expect(value.tenantId).toBe("id-1");
  });
  it("a missing GitHub installation cannot become a publishing account", async () => {
    mock.list.mockResolvedValue({ tenants: [{ ...tenants[0], installationId: null }] });
    await mount(); expect(value.tenants).toEqual([]); expect(value.tenantId).toBeUndefined();
  });
  it("failed authentication is unavailable account data, not a fabricated tenant", async () => {
    mock.list.mockRejectedValue(new Error("401"));
    await mount(); expect(value.tenantId).toBeUndefined(); expect(value.error).toMatch(/Could not load/);
  });
  it("makes no private account requests while the release gate is closed", async () => {
    mock.open = false; await mount(); expect(mock.list).not.toHaveBeenCalled(); expect(value.tenantId).toBeUndefined();
  });
});
