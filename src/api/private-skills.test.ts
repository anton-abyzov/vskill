import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const auth = vi.hoisted(() => ({ token: "vsk_test_private" }));
vi.mock("./client.js", () => ({ buildRequestHeaders: (_: unknown, opts: { tenantOverride?: string }) => ({ Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json", ...(opts.tenantOverride ? { "X-Vskill-Tenant": opts.tenantOverride } : {}) }) }));
import { computePrivateTreeHash, verifyPrivateDownload, resolvePrivateTenant, resolvePrivateSkill, downloadPrivateSkill, createPrivateSubmission, getPrivateSubmission, type PrivateDownload } from "./private-skills.js";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function fixture(files = { "SKILL.md": "# Helpful skill\nUse the included reference.\n", "references/readme.md": "A useful reference.\n" }): PrivateDownload {
  return { skill: { id: "skill1", name: "helpful", tenantId: "tenant1", privacy: "PRIVATE", repoUrl: "https://github.com/acme/private", skillPath: "skills/helpful/SKILL.md" }, version: "1.0.0", gitSha: "a".repeat(40), files, contentHash: hash(files["SKILL.md"]), treeHash: computePrivateTreeHash(files), manifest: Object.entries(files).map(([path, content]) => ({ path, sha256: hash(content), size: Buffer.byteLength(content), mode: "100644" })) };
}
const tenant = { tenantId: "tenant1", slug: "team", name: "Team", role: "OWNER", installationId: 44 };
const row = { id: "skill1", displayName: "helpful", repoSlug: "private", skillSlug: "helpful-123", tenantId: "tenant1" };
const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); auth.token = "vsk_test_private"; vi.stubEnv("VSKILL_API_BASE", "https://verified-skill.com"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("private artifact integrity", () => {
  it("validates exact identity, version, per-file bytes and the normalized tree", () => expect(verifyPrivateDownload(fixture(), "tenant1", "skill1", "1.0.0").version).toBe("1.0.0"));
  it.each(["../escape", "/absolute", "scripts/../../escape", "scripts\\escape", "c:/escape", "SKILL.md/../oops", " skill.md", "skill.md", "__proto__", "scripts/file."])("refuses unsafe path %s before installation", (path) => {
    const files = { ...fixture().files, [path]: "bad" };
    expect(() => verifyPrivateDownload(fixture(files), "tenant1")).toThrow();
  });
  it.each(["tenant", "skill", "version", "content", "tree", "file", "size", "mode", "missing", "duplicate", "case", "directory", "unicode"])("refuses %s mismatch", (kind) => {
    const data = fixture();
    if (kind === "tenant") data.skill.tenantId = "other";
    if (kind === "skill") data.skill.id = "other";
    if (kind === "version") data.version = "2.0.0";
    if (kind === "content") data.contentHash = "0".repeat(64);
    if (kind === "tree") data.treeHash = "0".repeat(64);
    if (kind === "file") data.files["references/readme.md"] += "tampered";
    if (kind === "size") data.manifest[0].size++;
    if (kind === "mode") data.manifest[0].mode = "120000" as never;
    if (kind === "missing") data.manifest.pop();
    if (kind === "duplicate") data.manifest[1] = data.manifest[0];
    if (kind === "case") Object.assign(data, fixture({ ...data.files, "References/Readme.md": "collision" }));
    if (kind === "directory") Object.assign(data, fixture({ ...data.files, references: "collision" }));
    if (kind === "unicode") Object.assign(data, fixture({ ...data.files, "é.txt": "a", "e\u0301.txt": "b" }));
    expect(() => verifyPrivateDownload(data, "tenant1", "skill1", "1.0.0")).toThrow();
  });
  it("normalizes BOM and CRLF for tree hash while keeping raw content hashes", () => {
    expect(computePrivateTreeHash({ "SKILL.md": "\uFEFFhello\r\n" })).toBe(computePrivateTreeHash({ "SKILL.md": "hello\n" }));
    expect(verifyPrivateDownload(fixture({ "SKILL.md": "\uFEFFhello\r\n", "references/readme.md": "docs" }), "tenant1")).toBeTruthy();
  });
});
describe("authenticated private transport", () => {
  it.each(["gho_broad", "ghp_broad", "github_pat_broad", "", "ghu_broad"])("never sends credential %s", async (token) => {
    auth.token = token;
    await expect(resolvePrivateTenant("team")).rejects.toThrow("Sign in");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("resolves live tenant and unique displayName then requests exact version with vsk only", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ tenants: [tenant] })).mockResolvedValueOnce(Response.json({ skills: [row], total: 1 })).mockResolvedValueOnce(Response.json(fixture()));
    const live = await resolvePrivateTenant("team");
    const resolved = await resolvePrivateSkill(live, "helpful");
    await downloadPrivateSkill(live, resolved.slug, resolved.row.id, "1.0.0");
    const [url, options] = fetchMock.mock.calls[2];
    expect(String(url)).toBe("https://verified-skill.com/api/v1/tenants/tenant1/skills/private%3Ahelpful-123/download?version=1.0.0");
    expect(options).toMatchObject({ redirect: "error", cache: "no-store", headers: { Authorization: "Bearer vsk_test_private", "X-Vskill-Tenant": "team" } });
  });
  it("rejects ambiguous display names and allows exact composite identities", async () => {
    const rows = [row, { ...row, id: "skill2", repoSlug: "another" }];
    fetchMock.mockImplementation(async () => Response.json({ skills: rows, total: 2 }));
    await expect(resolvePrivateSkill(tenant, "helpful")).rejects.toThrow("ambiguous");
    expect((await resolvePrivateSkill(tenant, "private:helpful-123")).row.id).toBe("skill1");
  });
  it("paginates without public search", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ skills: [{ ...row, displayName: "other" }], total: 2 })).mockResolvedValueOnce(Response.json({ skills: [row], total: 2 }));
    expect((await resolvePrivateSkill(tenant, "helpful")).slug).toBe("private:helpful-123");
    expect(String(fetchMock.mock.calls[1][0])).toContain("offset=1");
  });
  it("reports removed access without any registry fallback", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "not_found" }, { status: 404 }));
    await expect(downloadPrivateSkill(tenant, "private:helpful-123")).rejects.toThrow("not_found");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects insecure remote HTTP before fetch", async () => {
    vi.stubEnv("VSKILL_API_BASE", "http://remote.invalid");
    await expect(resolvePrivateTenant("team")).rejects.toThrow("HTTPS");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("creates and reads only scoped private submissions", async () => {
    const result = { id: "psub_abc", state: "RECEIVED", privacy: "PRIVATE", tenantId: "tenant1" };
    fetchMock.mockResolvedValueOnce(Response.json(result)).mockResolvedValueOnce(Response.json({ ...result, state: "PUBLISHED" }));
    await createPrivateSubmission(tenant, "https://github.com/acme/private", "helpful", "skills/helpful/SKILL.md");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ privacy: "private", tenantId: "tenant1" });
    expect((await getPrivateSubmission(tenant, result.id)).state).toBe("PUBLISHED");
  });
  it("fails a closed publishing gate without retry", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "private_publishing_unavailable" }, { status: 503 }));
    await expect(createPrivateSubmission(tenant, "https://github.com/acme/private", "helpful", "SKILL.md")).rejects.toThrow("private_publishing_unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects public or foreign-tenant submission responses", async () => {
    fetchMock.mockResolvedValue(Response.json({ id: "psub_abc", state: "PUBLISHED", privacy: "PRIVATE", tenantId: "foreign" }));
    await expect(getPrivateSubmission(tenant, "psub_abc")).rejects.toThrow("does not match");
  });
});
