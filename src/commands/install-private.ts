/** Install only authenticated, integrity-checked hosted private versions. */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";
import { detectInstalledAgents, getInstallableAgents, type AgentDefinition } from "../agents/agents-registry.js";
import { filterAgents } from "../utils/agent-filter.js";
import { ensureFrontmatter } from "../installer/frontmatter.js";
import { installSkillToAgents } from "../installer/multi-install.js";
import { getProjectRoot, readLockfile, writeLockfile, type SkillLockEntry } from "../lockfile/index.js";
import { runTier1Scan } from "../scanner/index.js";
import { downloadPrivateSkill, resolvePrivateSkill, resolvePrivateTenant, type PrivateDownload, type PrivateTenant } from "../api/private-skills.js";

export interface PrivateInstallOptions {
  tenant: string;
  version?: string;
  global?: boolean;
  scope?: string;
  cwd?: boolean;
  agent?: string | string[];
  copy?: boolean;
  dryRun?: boolean;
}
export function privateInstallName(tenant: PrivateTenant, download: PrivateDownload): string {
  const clean = (value: string, max: number) => value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max) || "skill";
  const identity = createHash("sha256").update(`${tenant.tenantId}\0${download.skill.id}`).digest("hex").slice(0, 12);
  return `private-${clean(tenant.slug, 16)}-${clean(download.skill.displayName || download.skill.name, 26)}-${identity}`;
}
function scanPrivateBundle(download: PrivateDownload): void {
  for (const [path, content] of Object.entries(download.files)) {
    const scan = runTier1Scan(content);
    if (scan.verdict === "FAIL") throw new Error(`Private skill security scan failed for ${path} (${scan.score}/100). No files installed.`);
  }
}
function supportsPrivateBundle(agent: AgentDefinition, scope: "user" | "project"): boolean {
  const sharedReader = agent.readsSharedSkills?.[scope === "user" ? "global" : "project"] === true;
  return !agent.isRemoteOnly && agent.installMode !== "clipboard" && (!agent.formatTransformer || sharedReader);
}
function installBundle(name: string, download: PrivateDownload, agents: AgentDefinition[], scope: "user" | "project", projectRoot: string, copy = false, previousFiles?: string[], previousFilesByAgent?: Record<string, string[]>): void {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw new Error("Invalid private install directory identity.");
  const unsupported = agents.filter((agent) => !supportsPrivateBundle(agent, scope));
  if (unsupported.length) throw new Error(`Hosted private bundles require native skill-folder support. Unsupported agents: ${unsupported.map((agent) => agent.id).join(", ")}. Use --agent codex or --agent claude-code.`);
  scanPrivateBundle(download);
  const files = Object.fromEntries(Object.entries(download.files).filter(([path]) => path !== "SKILL.md"));
  const written = installSkillToAgents({
    skillName: name, rawContent: ensureFrontmatter(download.files["SKILL.md"], name, true), agents, scope, projectRoot, copy,
    bundleFiles: files, bundleExecutables: download.manifest.filter((file) => file.mode === "100755").map((file) => file.path), previousFiles, previousFilesByAgent,
  });
  if (!written.length) throw new Error("No agent files were installed.");
}
function lockEntry(tenant: PrivateTenant, slug: string, download: PrivateDownload, scope: "user" | "project", agents: AgentDefinition[], copy: boolean): SkillLockEntry {
  return {
    version: download.version, sha: download.contentHash, tier: "SCANNED", installedAt: new Date().toISOString(),
    source: `hosted-private:${tenant.tenantId}/${slug}`, sourceType: "hosted-private", sourcePrivate: true,
    sourceRepoUrl: download.skill.repoUrl, sourceSkillPath: download.skill.skillPath, sourceCommitSha: download.gitSha,
    scope, files: Object.keys(download.files).sort(),
    hostedPrivate: { tenantId: tenant.tenantId, tenantSlug: tenant.slug, skillId: download.skill.id, skillSlug: slug, treeHash: download.treeHash, agents: agents.map((agent) => agent.id), agentFiles: Object.fromEntries(agents.map((agent) => [agent.id, Object.keys(download.files).sort()])), copy },
  };
}
export async function installPrivateCommand(source: string | undefined, opts: PrivateInstallOptions): Promise<void> {
  try {
    if (!source || source.includes("/")) throw new Error("Use vskill install --tenant <account> <private-skill-name> [--version 1.0.0].");
    if (opts.scope && !["user", "project"].includes(opts.scope)) throw new Error("Scope must be user or project.");
    if (opts.global && opts.scope === "project") throw new Error("--global conflicts with --scope project.");
    const tenant = await resolvePrivateTenant(opts.tenant);
    const { row, slug } = await resolvePrivateSkill(tenant, source);
    const download = await downloadPrivateSkill(tenant, slug, row.id, opts.version);
    const scope = opts.global || opts.scope === "user" ? "user" : "project";
    const projectRoot = opts.cwd ? process.cwd() : getProjectRoot();
    const lockDir = scope === "user" ? join(homedir(), ".agents") : projectRoot;
    const name = privateInstallName(tenant, download);
    const existing = readLockfile(lockDir);
    const old = existing?.skills[name];
    if (old && (old.hostedPrivate?.tenantId !== tenant.tenantId || old.hostedPrivate?.skillId !== row.id)) {
      throw new Error("Install identity conflicts with an existing skill. No files installed.");
    }
    const requested = typeof opts.agent === "string" ? [opts.agent] : opts.agent;
    let agents = filterAgents(requested?.length ? getInstallableAgents() : await detectInstalledAgents(), requested);
    if (!requested?.length) {
      const skipped = agents.filter((agent) => !supportsPrivateBundle(agent, scope));
      if (skipped.length) console.log(`Skipping agents without native private bundle support: ${skipped.map((agent) => agent.id).join(", ")}.`);
      agents = agents.filter((agent) => supportsPrivateBundle(agent, scope));
    }
    if (!agents.length) throw new Error("No agents with native skill-folder support detected. Select one explicitly with --agent codex or --agent claude-code.");
    if (agents.some((agent) => !supportsPrivateBundle(agent, scope))) throw new Error("Hosted private bundles require native skill-folder support. Use --agent codex or --agent claude-code.");
    scanPrivateBundle(download);
    if (opts.dryRun) {
      console.log(`Would install private ${name}@${download.version} for ${agents.map((a) => a.id).join(", ")} (${scope}).`);
      return;
    }
    const previousInventories = privateAgentFiles(old);
    const copy = opts.copy ?? old?.hostedPrivate?.copy ?? false;
    installBundle(name, download, agents, scope, projectRoot, copy, old?.files, previousInventories);
    const now = new Date().toISOString();
    const lock = existing ?? { version: 1 as const, agents: [], skills: {}, createdAt: now, updatedAt: now };
    const next = lockEntry(tenant, slug, download, scope, agents, copy);
    next.hostedPrivate!.agents = [...new Set([...(old?.hostedPrivate?.agents ?? []), ...next.hostedPrivate!.agents])];
    next.hostedPrivate!.agentFiles = { ...previousInventories, ...next.hostedPrivate!.agentFiles };
    lock.skills[name] = { ...next, ...(opts.version ? { pinnedVersion: opts.version } : {}) };
    lock.agents = [...new Set([...lock.agents, ...agents.map((a) => a.id)])];
    writeLockfile(lock, lockDir);
    console.log(`Installed private ${name}@${download.version} (${scope}).${opts.version ? " Version pinned." : ""}`);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}

function privateAgentFiles(entry?: SkillLockEntry): Record<string, string[]> {
  if (!entry?.hostedPrivate) return {};
  return Object.fromEntries(entry.hostedPrivate.agents.map((id) => [id, entry.hostedPrivate!.agentFiles?.[id] ?? entry.files ?? []]));
}

/** updateCommand branches here before source parsing or any public lookup. */
export async function updateHostedPrivateSkill(name: string, entry: SkillLockEntry, agents: AgentDefinition[], projectRoot: string): Promise<SkillLockEntry> {
  const provenance = entry.hostedPrivate;
  if (!provenance || !entry.sourcePrivate) throw new Error("Hosted private skill is missing its tenant provenance.");
  const tenant = await resolvePrivateTenant(provenance.tenantSlug);
  if (tenant.tenantId !== provenance.tenantId) throw new Error("Account identity changed; refusing to replace a private skill.");
  const download = await downloadPrivateSkill(tenant, provenance.skillSlug, provenance.skillId);
  const unchanged = entry.version === download.version && provenance.treeHash === download.treeHash;
  const selected = agents.filter((agent) => provenance.agents.includes(agent.id));
  if (!selected.length) throw new Error("None of this private skill's installed agents are selected.");
  const inventories = privateAgentFiles(entry);
  installBundle(name, download, selected, entry.scope ?? "project", projectRoot, provenance.copy, entry.files, inventories);
  const nextFiles = Object.keys(download.files).sort();
  const inventoryChanged = selected.some((agent) => JSON.stringify(inventories[agent.id]) !== JSON.stringify(nextFiles));
  const nextInventories = { ...inventories, ...Object.fromEntries(selected.map((agent) => [agent.id, nextFiles])) };
  // A shared lock version cannot prove every agent copy is current: an earlier
  // --agent update or a partial install may have left another copy behind.
  if (unchanged && !inventoryChanged && provenance.agentFiles) return entry;
  return { ...entry, ...lockEntry(tenant, provenance.skillSlug, download, entry.scope ?? "project", selected, provenance.copy),
    hostedPrivate: { ...provenance, treeHash: download.treeHash, agentFiles: nextInventories } };
}
