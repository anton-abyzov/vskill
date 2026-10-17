/** Synthetic loopback proof: real HTTP, cryptographic verification, canonical writes and lock readback. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, existsSync, realpathSync, statSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const state = vi.hoisted(() => ({ root: "", token: "vsk_synthetic_loopback" }));
vi.mock("../../api/client.js", () => ({ buildRequestHeaders: (_: unknown, opts: { tenantOverride?: string }) => ({ Authorization: `Bearer ${state.token}`, "Content-Type": "application/json", ...(opts.tenantOverride ? { "X-Vskill-Tenant": opts.tenantOverride } : {}) }) }));
vi.mock("../../lockfile/project-root.js", () => ({ getProjectRoot: () => state.root }));
import { getInstallableAgents } from "../../agents/agents-registry.js";
import { readLockfile } from "../../lockfile/index.js";
import { computePrivateTreeHash, type PrivateDownload } from "../../api/private-skills.js";
import { installPrivateCommand, privateInstallName, updateHostedPrivateSkill } from "../install-private.js";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const tenant = { tenantId: "tenant1", slug: "team", name: "Team", role: "OWNER", installationId: 22 };
const row = { id: "skill1", displayName: "helpful", repoSlug: "private", skillSlug: "helpful-123", tenantId: "tenant1" };
let artifact: PrivateDownload;
let server: Server;
let calls: Array<{ path: string; auth?: string; tenant?: string }>;
let failure = 0;
let account = tenant;
function bundle(version = "1.0.0", files: Record<string, string> = { "SKILL.md": "---\nname: helpful\ndescription: A helpful private skill\n---\n# Helpful\nRead references/readme.md.\n", "references/readme.md": "Synthetic private reference.\n", "scripts/check.sh": "#!/bin/sh\nprintf 'checked\\n'\n" }): PrivateDownload {
  return { skill: { id: "skill1", name: "helpful", displayName: "helpful", privacy: "PRIVATE", tenantId: "tenant1", repoUrl: "https://github.com/acme/private", skillPath: "skills/helpful/SKILL.md" }, version, gitSha: "a".repeat(40), files, contentHash: hash(files["SKILL.md"]), treeHash: computePrivateTreeHash(files), manifest: Object.entries(files).map(([path, content]) => ({ path, sha256: hash(content), size: Buffer.byteLength(content), mode: path.endsWith(".sh") ? "100755" : "100644" })) };
}
beforeEach(async () => {
  state.root = mkdtempSync(join(tmpdir(), "vskill-private-proof-"));
  state.token = "vsk_synthetic_loopback"; process.exitCode = 0; artifact = bundle(); calls = []; failure = 0; account = tenant;
  vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {});
  server = createServer((req, res) => {
    calls.push({ path: req.url!, auth: req.headers.authorization, tenant: req.headers["x-vskill-tenant"] as string });
    res.setHeader("Content-Type", "application/json");
    if (req.headers.authorization !== "Bearer vsk_synthetic_loopback") { res.statusCode = 401; res.end(JSON.stringify({ error: "auth_required" })); return; }
    if (req.url === "/api/v1/account/tenants") { res.end(JSON.stringify({ tenants: [account] })); return; }
    if (req.url === `/api/v1/tenants/${account.tenantId}/skills?limit=100&offset=0`) { res.end(JSON.stringify({ skills: [{ ...row, tenantId: account.tenantId }], total: 1 })); return; }
    if (req.url?.startsWith(`/api/v1/tenants/${account.tenantId}/skills/private%3Ahelpful-123/download`)) {
      res.statusCode = failure || 200; res.end(JSON.stringify(failure ? { error: "not_found" } : artifact)); return;
    }
    res.statusCode = 500; res.end(JSON.stringify({ error: "UNEXPECTED_PUBLIC_EGRESS" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  vi.stubEnv("VSKILL_API_BASE", `http://127.0.0.1:${(server.address() as { port: number }).port}`);
});
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(state.root, { recursive: true, force: true }); process.exitCode = 0; vi.restoreAllMocks(); vi.unstubAllEnvs();
});
describe("hosted private install through real loopback HTTP", () => {
  it("installs a pinned full bundle for Codex and Claude with verified provenance and executable mode", async () => {
    await installPrivateCommand("helpful", { tenant: "team", version: "1.0.0", agent: ["codex", "claude-code"] });
    expect(process.exitCode).toBe(0);
    const name = privateInstallName(tenant, artifact);
    const canonical = join(state.root, ".agents/skills", name);
    expect(readFileSync(join(canonical, "references/readme.md"), "utf8")).toBe(artifact.files["references/readme.md"]);
    expect(readFileSync(join(canonical, "SKILL.md"), "utf8")).toContain("# Helpful");
    expect(readFileSync(join(canonical, "SKILL.md"), "utf8")).toContain(`name: ${name}\n`);
    expect(realpathSync(join(state.root, ".claude/skills", name))).toBe(realpathSync(canonical));
    expect(statSync(join(canonical, "scripts/check.sh")).mode & 0o111).toBe(0o111);
    const entry = readLockfile(state.root)!.skills[name];
    expect(entry).toMatchObject({ version: "1.0.0", pinnedVersion: "1.0.0", sourcePrivate: true, sourceType: "hosted-private", sourceCommitSha: "a".repeat(40), hostedPrivate: { tenantId: "tenant1", skillId: "skill1", treeHash: artifact.treeHash } });
    expect(calls).toHaveLength(3);
    expect(calls[2].path).toContain("?version=1.0.0");
    expect(calls.every((call) => call.auth === "Bearer vsk_synthetic_loopback")).toBe(true);
    if (process.env.VSKILL_PRIVATE_PROOF_REPORT) {
      writeFileSync(process.env.VSKILL_PRIVATE_PROOF_REPORT, JSON.stringify({
        synthetic: true, production: false, at: new Date().toISOString(), transport: "real authenticated loopback HTTP",
        requests: calls.map(({ path, tenant: account }) => ({ path, tenant: account, credentialKind: "synthetic vsk" })),
        installedName: name, version: entry.version, pinnedVersion: entry.pinnedVersion,
        sourcePrivate: entry.sourcePrivate, provenance: entry.hostedPrivate,
        readback: { canonicalSkill: true, fullReferenceBytesMatch: true, claudeSymlinkMatchesCanonical: true, executableMode: "755" },
        globalCredentialsChanged: false, personalSkillFilesChanged: false, temporaryInstallRemovedAfterTest: true,
      }, null, 2));
    }
  });
  it.each(["tamper", "traversal", "wrong-version", "foreign-tenant", "revoked"])("writes nothing on %s", async (kind) => {
    if (kind === "tamper") artifact.files["references/readme.md"] = "tampered";
    if (kind === "traversal") artifact = bundle("1.0.0", { ...artifact.files, "../escape": "bad" });
    if (kind === "wrong-version") artifact.version = "2.0.0";
    if (kind === "foreign-tenant") artifact.skill.tenantId = "other";
    if (kind === "revoked") failure = 404;
    await installPrivateCommand("helpful", { tenant: "team", version: "1.0.0", agent: ["codex"] });
    expect(process.exitCode).toBe(1);
    expect(existsSync(join(state.root, ".agents"))).toBe(false);
    expect(readLockfile(state.root)).toBeNull();
    expect(calls.every((call) => call.path.startsWith("/api/v1/account/") || call.path.startsWith("/api/v1/tenants/"))).toBe(true);
  });
  it("updates through private download and removes files absent in the new full manifest", async () => {
    await installPrivateCommand("helpful", { tenant: "team", agent: ["codex", "claude-code"] });
    const name = privateInstallName(tenant, artifact);
    const old = readLockfile(state.root)!.skills[name];
    artifact = bundle("1.1.0", { "SKILL.md": artifact.files["SKILL.md"] + "\nUpdated.\n", "references/new.md": "New private reference." });
    const next = await updateHostedPrivateSkill(name, old, getInstallableAgents().filter((agent) => ["codex", "claude-code"].includes(agent.id)), state.root);
    expect(next.version).toBe("1.1.0");
    expect(next.sourcePrivate).toBe(true);
    const canonical = join(state.root, ".agents/skills", name);
    expect(readFileSync(join(canonical, "references/new.md"), "utf8")).toBe("New private reference.");
    expect(existsSync(join(canonical, "references/readme.md"))).toBe(false);
    expect(existsSync(join(canonical, "scripts/check.sh"))).toBe(false);
    expect(calls).toHaveLength(5);
  });
  it("repairs an agent copy even when a previous filtered update already advanced the shared lock version", async () => {
    await installPrivateCommand("helpful", { tenant: "team", agent: ["codex", "claude-code"], copy: true });
    const name = privateInstallName(tenant, artifact);
    const old = readLockfile(state.root)!.skills[name];
    const claudeFile = join(state.root, ".claude/skills", name, "SKILL.md");
    const oldClaude = readFileSync(claudeFile, "utf8");
    artifact = bundle("1.1.0", { "SKILL.md": artifact.files["SKILL.md"] + "\nUpdated copy.\n" });
    const agents = getInstallableAgents();
    const advanced = await updateHostedPrivateSkill(name, old, agents.filter((agent) => agent.id === "codex"), state.root);
    expect(advanced.version).toBe("1.1.0");
    expect(readFileSync(claudeFile, "utf8")).toBe(oldClaude);
    const staleScript = join(state.root, ".claude/skills", name, "scripts/check.sh");
    expect(existsSync(staleScript)).toBe(true);
    const userNote = join(state.root, ".claude/skills", name, "user-notes.txt");
    writeFileSync(userNote, "Keep my untracked notes.");
    artifact = bundle("1.2.0", { ...artifact.files, "references/new.md": "Third version reference." });
    const advancedAgain = await updateHostedPrivateSkill(name, advanced, agents.filter((agent) => agent.id === "codex"), state.root);
    const caughtUp = await updateHostedPrivateSkill(name, advancedAgain, agents.filter((agent) => agent.id === "claude-code"), state.root);
    expect(readFileSync(claudeFile, "utf8")).toContain("Updated copy.");
    expect(existsSync(staleScript)).toBe(false);
    expect(existsSync(join(state.root, ".claude/skills", name, "references/readme.md"))).toBe(false);
    expect(readFileSync(userNote, "utf8")).toBe("Keep my untracked notes.");
    expect(caughtUp.hostedPrivate?.agentFiles?.["claude-code"]).toEqual(["SKILL.md", "references/new.md"]);
    expect(advanced.hostedPrivate?.agentFiles?.["claude-code"]).toContain("scripts/check.sh");
  });

  it("isolates two tenant bundles with identical source frontmatter for native readers", async () => {
    await installPrivateCommand("helpful", { tenant: "team", agent: ["codex", "claude-code"] });
    const firstName = privateInstallName(account, artifact);
    const firstFile = join(state.root, ".agents/skills", firstName, "SKILL.md");
    const firstBytes = readFileSync(firstFile, "utf8");
    account = { ...tenant, tenantId: "tenant2", slug: "other" };
    artifact = bundle("1.0.0", { ...artifact.files, "SKILL.md": artifact.files["SKILL.md"] + "\nOther account.\n" });
    artifact.skill.tenantId = "tenant2";
    await installPrivateCommand("helpful", { tenant: "other", agent: ["codex", "claude-code"] });
    expect(process.exitCode).toBe(0);
    const secondName = privateInstallName(account, artifact);
    expect(firstName).not.toBe(secondName);
    expect(readFileSync(firstFile, "utf8")).toBe(firstBytes);
    expect(readFileSync(join(state.root, ".agents/skills", secondName, "SKILL.md"), "utf8")).toContain(`name: ${secondName}\n`);
    expect(Object.keys(readLockfile(state.root)!.skills)).toHaveLength(2);
  });

  it("rejects a transformer-only agent before writing or recording a partial private bundle", async () => {
    await installPrivateCommand("helpful", { tenant: "team", agent: ["codex", "windsurf"] });
    expect(process.exitCode).toBe(1);
    expect(existsSync(join(state.root, ".agents"))).toBe(false);
    expect(existsSync(join(state.root, ".windsurf"))).toBe(false);
    expect(readLockfile(state.root)).toBeNull();
  });

  it("dry run verifies without writing", async () => {
    await installPrivateCommand("helpful", { tenant: "team", agent: ["codex"], dryRun: true });
    expect(process.exitCode).toBe(0); expect(readLockfile(state.root)).toBeNull(); expect(existsSync(join(state.root, ".agents"))).toBe(false);
  });
  it("isolates identities across tenants and keeps install names valid", () => {
    const a = privateInstallName(tenant, artifact);
    const b = privateInstallName({ ...tenant, tenantId: "other" }, artifact);
    expect(a).not.toBe(b);
    expect(privateInstallName({ ...tenant, slug: "a".repeat(300) }, { ...artifact, skill: { ...artifact.skill, displayName: "b".repeat(400) } })).toMatch(/^[a-z0-9-]{1,64}$/);
  });
});
