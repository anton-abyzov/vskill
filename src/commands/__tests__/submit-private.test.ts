import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ tenant: vi.fn(), create: vi.fn(), status: vi.fn(), versions: vi.fn(), browser: vi.fn() }));
vi.mock("../../api/private-skills.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../api/private-skills.js")>()), resolvePrivateTenant: mocks.tenant, createPrivateSubmission: mocks.create, getPrivateSubmission: mocks.status }));
vi.mock("../../api/client.js", () => ({ getVersions: mocks.versions }));
vi.mock("../../utils/browser.js", () => ({ openBrowser: mocks.browser }));
import { submitPrivateCommand } from "../submit-private.js";
const tenant = { tenantId: "tenant1", slug: "team", installationId: 23, name: "Team", role: "OWNER" };
const result = { id: "psub_abc", tenantId: "tenant1", privacy: "PRIVATE", state: "RECEIVED" };
beforeEach(() => {
  vi.clearAllMocks(); process.exitCode = 0;
  vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.tenant.mockResolvedValue(tenant); mocks.create.mockResolvedValue(result); mocks.status.mockResolvedValue({ ...result, state: "PUBLISHED" });
});
afterEach(() => { vi.useRealTimers(); process.exitCode = 0; vi.restoreAllMocks(); });
describe("explicit private CLI submissions", () => {
  it("submits to live tenant with exact SKILL.md path and polls authenticated status", async () => {
    vi.useFakeTimers();
    const task = submitPrivateCommand("acme/private", { tenant: "team", skill: "helpful", path: "./skills/helpful/SKILL.md" });
    await vi.runAllTimersAsync(); await task;
    expect(mocks.create).toHaveBeenCalledWith(tenant, "https://github.com/acme/private", "helpful", "skills/helpful/SKILL.md");
    expect(mocks.status).toHaveBeenCalledWith(tenant, "psub_abc");
    expect(mocks.versions).not.toHaveBeenCalled(); expect(mocks.browser).not.toHaveBeenCalled(); expect(process.exitCode).toBe(0);
  });
  it("allows no-wait and later authenticated resume without duplicate create", async () => {
    await submitPrivateCommand("acme/private", { tenant: "team", wait: false });
    expect(mocks.status).not.toHaveBeenCalled();
    await submitPrivateCommand(undefined, { tenant: "team", submission: "psub_abc" });
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.status).toHaveBeenCalledTimes(1);
  });
  it.each(["missing-tenant", "missing-app", "browser", "path-traversal", "directory"])("refuses %s before submission", async (kind) => {
    const opts = { tenant: "team", wait: false, path: "SKILL.md", browser: false };
    if (kind === "missing-tenant") opts.tenant = "";
    if (kind === "missing-app") mocks.tenant.mockResolvedValue({ ...tenant, installationId: null });
    if (kind === "browser") opts.browser = true;
    if (kind === "path-traversal") opts.path = "../SKILL.md";
    if (kind === "directory") opts.path = "skills/helpful";
    await submitPrivateCommand("acme/private", opts);
    expect(process.exitCode).toBe(1); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.browser).not.toHaveBeenCalled();
  });
  it.each(["private_publishing_unavailable", "TENANT_LIMIT_REACHED", "private_repository_unavailable", "forbidden"])("keeps %s inline without public fallback", async (error) => {
    mocks.create.mockRejectedValue(new Error(error));
    await submitPrivateCommand("acme/private", { tenant: "team", wait: false });
    expect(process.exitCode).toBe(1); expect(mocks.versions).not.toHaveBeenCalled(); expect(mocks.browser).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(error);
  });
  it("fails when private verification rejects", async () => {
    mocks.create.mockResolvedValue({ ...result, state: "REJECTED", error: "Scan rejected" });
    await submitPrivateCommand("acme/private", { tenant: "team" });
    expect(process.exitCode).toBe(1); expect(mocks.status).not.toHaveBeenCalled();
  });
});
