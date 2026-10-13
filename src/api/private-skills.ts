/** Authenticated hosted-private API. Never retries against the public registry. */
import { createHash } from "node:crypto";
import { buildRequestHeaders } from "./client.js";
import { assertSafeBundlePath } from "../installer/bundle-files.js";

export interface PrivateTenant {
  tenantId: string;
  slug: string;
  name: string;
  role: string;
  installationId?: string | number | null;
}
export interface PrivateSkillRow {
  id: string;
  displayName: string;
  repoSlug: string;
  skillSlug: string;
  tenantId: string;
}
export interface PrivateDownload {
  skill: { id: string; name: string; displayName?: string; privacy: "PRIVATE"; tenantId: string; repoUrl: string; skillPath: string };
  version: string;
  gitSha: string;
  contentHash: string;
  treeHash: string;
  manifest: Array<{ path: string; sha256: string; size: number; mode: "100644" | "100755" }>;
  files: Record<string, string>;
}
export interface PrivateSubmission {
  id: string;
  state: string;
  privacy: "PRIVATE";
  tenantId: string;
  error?: string | null;
  publishedSkillName?: string | null;
}
export const PRIVATE_TERMINAL_STATES = new Set(["PUBLISHED", "REJECTED", "TIER1_FAILED", "TIER2_FAILED", "BLOCKED", "FAILED"]);
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

export function assertPrivateVersion(version: string): void {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("Specify an exact version, such as --version 1.0.0.");
  }
}

/** Strict paths also protect case-insensitive and Unicode-normalizing filesystems. */
export function assertPrivateFilePath(path: string): void {
  if (typeof path !== "string" || path !== path.trim() || /[\\:\x00-\x1f]/.test(path)) {
    throw new Error("Invalid private bundle path.");
  }
  if (path.split("/").some((part) => ["__proto__", "constructor", "prototype"].includes(part) || /[. ]$/.test(part))) {
    throw new Error("Invalid private bundle path component.");
  }
  if (path !== "SKILL.md") assertSafeBundlePath(path, { anyPath: true });
}

export function computePrivateTreeHash(files: Record<string, string>): string {
  const digest = createHash("sha256");
  for (const path of Object.keys(files).sort()) {
    digest.update(`${path}\0${files[path].replace(/^\uFEFF/, "").replace(/\r\n/g, "\n")}\n`);
  }
  return digest.digest("hex");
}

/** All integrity and scope checks happen before the installer can write anything. */
export function verifyPrivateDownload(value: unknown, tenantId: string, skillId?: string, version?: string): PrivateDownload {
  const data = value as PrivateDownload;
  if (!data || data.skill?.privacy !== "PRIVATE" || data.skill.tenantId !== tenantId ||
      typeof data.skill.id !== "string" || !data.skill.id || (skillId && data.skill.id !== skillId)) {
    throw new Error("Private download identity does not match the requested account and skill.");
  }
  if (typeof data.version !== "string") throw new Error("Private download has no version.");
  assertPrivateVersion(data.version);
  if (version && data.version !== version) throw new Error("Private download returned a different version than requested.");
  if (!/^[a-f0-9]{40}$/i.test(data.gitSha ?? "")) throw new Error("Private download has an invalid commit identity.");
  if (!data.files || typeof data.files !== "object" || Array.isArray(data.files) ||
      typeof data.files["SKILL.md"] !== "string" || !Array.isArray(data.manifest)) {
    throw new Error("Private download is missing its file manifest or SKILL.md.");
  }
  const paths = Object.keys(data.files).sort();
  if (paths.length !== data.manifest.length || paths.length > 10_000) throw new Error("Private manifest does not cover the downloaded files.");
  const seen = new Set<string>();
  const canonicalPaths = new Set<string>();
  let totalBytes = 0;
  for (const item of data.manifest) {
    if (!item || typeof item.path !== "string") throw new Error("Invalid private manifest entry.");
    assertPrivateFilePath(item.path);
    const canonical = item.path.normalize("NFC").toLowerCase();
    if (seen.has(item.path) || canonicalPaths.has(canonical)) throw new Error("Private bundle contains colliding paths.");
    seen.add(item.path);
    canonicalPaths.add(canonical);
    if (!Object.hasOwn(data.files, item.path) || typeof data.files[item.path] !== "string") throw new Error("Private manifest contains a missing or non-text file.");
    const content = data.files[item.path];
    totalBytes += Buffer.byteLength(content, "utf8");
    if (totalBytes > 32 * 1024 * 1024) throw new Error("Private bundle exceeds the install size limit.");
    if (!/^[a-f0-9]{64}$/i.test(item.sha256) || item.sha256 !== hash(content) || item.size !== Buffer.byteLength(content, "utf8")) {
      throw new Error(`Private bundle integrity failed for ${item.path}.`);
    }
    if (item.mode !== "100644" && item.mode !== "100755") throw new Error("Private bundle contains an unsupported file mode.");
  }
  for (const path of canonicalPaths) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      if (canonicalPaths.has(parts.slice(0, i).join("/"))) throw new Error("Private bundle contains a file/directory collision.");
    }
  }
  if (paths.some((path) => !seen.has(path)) || data.contentHash !== hash(data.files["SKILL.md"]) || data.treeHash !== computePrivateTreeHash(data.files)) {
    throw new Error("Private bundle content or tree integrity failed.");
  }
  return data;
}

async function privateRequest<T>(path: string, tenant?: string, init: RequestInit = {}): Promise<T> {
  const headers = buildRequestHeaders(undefined, { tenantOverride: tenant ?? null });
  if (!/^Bearer vsk_[A-Za-z0-9_-]+$/.test(headers.Authorization ?? "")) {
    throw new Error("Sign in with vskill auth login before using hosted private skills.");
  }
  const base = new URL(process.env.VSKILL_API_BASE || "https://verified-skill.com");
  if (base.username || base.password || (base.protocol !== "https:" &&
      !(base.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)))) {
    throw new Error("Hosted private skills require HTTPS (or a loopback test server).");
  }
  const response = await fetch(new URL(path, base), {
    ...init, headers, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    let error: { error?: string; message?: string } = {};
    try { error = await response.json() as typeof error; } catch { /* non-JSON error */ }
    const code = typeof error.error === "string" ? error.error : `HTTP ${response.status}`;
    const details = typeof error.message === "string" ? `: ${error.message}` : "";
    throw new Error(`Hosted private request failed (${code})${details}`);
  }
  return response.json() as Promise<T>;
}

export async function resolvePrivateTenant(slug: string): Promise<PrivateTenant> {
  if (!slug?.trim()) throw new Error("Select an account with --tenant <slug>. Connect the GitHub App if no accounts are available.");
  const data = await privateRequest<{ tenants?: Array<PrivateTenant & { id?: string }> }>("/api/v1/account/tenants");
  const matches = (data.tenants ?? []).filter((tenant) => tenant.slug === slug || (tenant.tenantId ?? tenant.id) === slug);
  if (matches.length !== 1) throw new Error("Publishing account not found. Run vskill orgs list or connect the GitHub App at https://verified-skill.com/settings/integrations.");
  const tenant = matches[0];
  const tenantId = tenant.tenantId ?? tenant.id;
  if (!tenantId || !tenant.slug) throw new Error("Account response is missing its tenant identity.");
  return { ...tenant, tenantId };
}

export async function resolvePrivateSkill(tenant: PrivateTenant, name: string): Promise<{ row: PrivateSkillRow; slug: string }> {
  const rows: PrivateSkillRow[] = [];
  let offset = 0;
  for (;;) {
    const data = await privateRequest<{ skills: PrivateSkillRow[]; total: number }>(
      `/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/skills?limit=100&offset=${offset}`, tenant.slug,
    );
    if (!Array.isArray(data.skills)) throw new Error("Invalid private skill listing.");
    rows.push(...data.skills);
    offset += data.skills.length;
    if (offset >= data.total || data.skills.length === 0) break;
    if (offset >= 100_000) throw new Error("Private skill listing exceeds the supported limit.");
  }
  const matches = rows.filter((row) => row.tenantId === tenant.tenantId &&
    (row.displayName === name || `${row.repoSlug}:${row.skillSlug}` === name));
  if (matches.length !== 1) {
    throw new Error(matches.length ? "Private skill name is ambiguous. Use the repoSlug:skillSlug from your account's skill list." : "Private skill not found in this account.");
  }
  const row = matches[0];
  if (!row.id || !row.repoSlug || !row.skillSlug) throw new Error("Private skill is missing its download identity.");
  return { row, slug: `${row.repoSlug}:${row.skillSlug}` };
}

export async function downloadPrivateSkill(tenant: PrivateTenant, slug: string, skillId?: string, version?: string): Promise<PrivateDownload> {
  if (version) assertPrivateVersion(version);
  const query = version ? `?version=${encodeURIComponent(version)}` : "";
  const data = await privateRequest<unknown>(`/api/v1/tenants/${encodeURIComponent(tenant.tenantId)}/skills/${encodeURIComponent(slug)}/download${query}`, tenant.slug);
  return verifyPrivateDownload(data, tenant.tenantId, skillId, version);
}

function verifySubmission(data: PrivateSubmission, tenantId: string, expectedId?: string): PrivateSubmission {
  if (!/^psub_[A-Za-z0-9-]+$/.test(data?.id ?? "") || (expectedId && data.id !== expectedId) || data.privacy !== "PRIVATE" || data.tenantId !== tenantId || typeof data.state !== "string") {
    throw new Error("Submission response does not match the private account request.");
  }
  return data;
}
export async function createPrivateSubmission(tenant: PrivateTenant, repoUrl: string, skillName: string, skillPath: string): Promise<PrivateSubmission> {
  const data = await privateRequest<PrivateSubmission>("/api/v1/submissions", tenant.slug, {
    method: "POST", body: JSON.stringify({ repoUrl, skillName, skillPath, privacy: "private", tenantId: tenant.tenantId, source: "cli-submit" }),
  });
  return verifySubmission(data, tenant.tenantId);
}
export async function getPrivateSubmission(tenant: PrivateTenant, id: string): Promise<PrivateSubmission> {
  if (!/^psub_[A-Za-z0-9-]+$/.test(id)) throw new Error("Invalid private submission identity.");
  const data = await privateRequest<PrivateSubmission>(`/api/v1/submissions/${encodeURIComponent(id)}`, tenant.slug);
  return verifySubmission(data, tenant.tenantId, id);
}
