// ---------------------------------------------------------------------------
// 0932: the lock `tier` of an installed skill comes from the registry.
//
// A skill is VERIFIED only when the SKILL.md that was installed hashes to a
// version verified-skill.com published (the registry stores the SHA-256 of
// SKILL.md per version, raw or canonical: CRLF -> LF, top-level `version:`
// stripped). Anything else (content newer than the last publish, a skill the
// registry never saw, a private repo, an unreachable registry) is UNSCANNED,
// and the install says why.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { listRegistryVersions, type RegistryVersion } from "./registry-version.js";
import { dim, yellow } from "../utils/output.js";

export type RegistryTier = "VERIFIED" | "UNSCANNED";

export interface RegistryTierDecision {
  tier: RegistryTier;
  /** Registry version whose hash matched the installed content. */
  matchedVersion?: string;
  /** Newest version the registry has, when it answered. */
  latestVersion?: string;
  /** Why the skill is not VERIFIED. */
  reason?: "private" | "not_published" | "content_differs" | "unreachable" | "no_identity";
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Same rule as the platform's canonicalContentHash (lib/integrity/canonical-hash.ts). */
export function stripTopLevelVersion(content: string): string {
  const fmRe = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
  const match = content.match(fmRe);
  if (!match) return content;
  const stripped = match[1].replace(/^version\s*:\s*[^\n]*\r?\n?/m, "");
  if (stripped === match[1]) return content;
  return content.replace(fmRe, `---\n${stripped}\n---\n`);
}

/** Every hash the registry may have recorded for this SKILL.md. */
export function skillContentHashes(content: string): Set<string> {
  const lf = content.replace(/\r\n/g, "\n");
  return new Set([sha256Hex(content), sha256Hex(lf), sha256Hex(stripTopLevelVersion(lf))]);
}

function normaliseHash(hash: string | null): string | null {
  if (!hash) return null;
  const h = hash.trim().toLowerCase().replace(/^sha256[:-]/, "");
  return /^[0-9a-f]{64}$/.test(h) ? h : null;
}

/** Match installed content against already-fetched registry versions. */
export function matchRegistryVersion(
  versions: RegistryVersion[],
  content: string,
): RegistryTierDecision {
  const latestVersion = versions[0]?.version;
  if (versions.length === 0) return { tier: "UNSCANNED", reason: "not_published" };
  const hashes = skillContentHashes(content);
  const match = versions.find((v) => {
    const h = normaliseHash(v.contentHash);
    return h !== null && hashes.has(h);
  });
  if (match) return { tier: "VERIFIED", matchedVersion: match.version, latestVersion };
  return { tier: "UNSCANNED", latestVersion, reason: "content_differs" };
}

export interface DecideTierOptions {
  /** A private (or unconfirmed) repo: never asks the registry. */
  privateRepo?: boolean;
}

/**
 * Decide the lock tier for `fullName` (owner/repo/skill, or a registry name)
 * given the SKILL.md content that was installed. Never throws.
 */
export async function decideRegistryTier(
  fullName: string | null,
  content: string,
  opts: DecideTierOptions = {},
): Promise<RegistryTierDecision> {
  if (opts.privateRepo) return { tier: "UNSCANNED", reason: "private" };
  if (!fullName) return { tier: "UNSCANNED", reason: "no_identity" };
  let versions: RegistryVersion[];
  try {
    versions = await listRegistryVersions(fullName);
  } catch (err) {
    if ((err as { status?: number }).status === 404) return { tier: "UNSCANNED", reason: "not_published" };
    return { tier: "UNSCANNED", reason: "unreachable" };
  }
  return matchRegistryVersion(versions, content);
}

/**
 * Several skills installed under one lock entry (a plugin): VERIFIED only
 * when every one of them matches a published version.
 */
export async function decideRegistryTierForSkills(
  ownerRepo: string | null,
  skills: Array<{ name: string; content: string }>,
  opts: DecideTierOptions = {},
): Promise<RegistryTierDecision> {
  if (skills.length === 0) return { tier: "UNSCANNED", reason: "no_identity" };
  let first: RegistryTierDecision | null = null;
  for (const s of skills) {
    const d = await decideRegistryTier(ownerRepo ? `${ownerRepo}/${s.name}` : null, s.content, opts);
    if (d.tier !== "VERIFIED") return d;
    first ??= d;
  }
  return first!;
}

/** SKILL.md bodies of a local plugin folder (`skills/<name>/SKILL.md`, or a root SKILL.md). */
export function readPluginDirSkills(pluginDir: string): Array<{ name: string; content: string }> {
  const out: Array<{ name: string; content: string }> = [];
  try {
    const skillsDir = join(pluginDir, "skills");
    if (existsSync(skillsDir)) {
      for (const d of readdirSync(skillsDir, { withFileTypes: true }) ?? []) {
        const file = join(skillsDir, d.name, "SKILL.md");
        if (d.isDirectory() && existsSync(file)) out.push({ name: d.name, content: readFileSync(file, "utf8") });
      }
    }
    const root = join(pluginDir, "SKILL.md");
    if (out.length === 0 && existsSync(root)) {
      out.push({ name: pluginDir.split(/[\\/]/).filter(Boolean).pop() ?? "skill", content: readFileSync(root, "utf8") });
    }
  } catch {
    // unreadable folder: no registry identity, recorded as UNSCANNED
  }
  return out;
}

/** One line describing an UNSCANNED decision, or null for VERIFIED / private skills. */
export function tierNote(name: string, d: RegistryTierDecision): string | null {
  if (d.tier === "VERIFIED" || d.reason === "private" || d.reason === "no_identity") return null;
  if (d.reason === "unreachable") {
    return `verified-skill.com could not be reached, so ${name} is recorded as UNSCANNED.`;
  }
  if (d.reason === "not_published") {
    return `${name} is not published on verified-skill.com; recorded as UNSCANNED.`;
  }
  return (
    `${name} does not match a published version` +
    (d.latestVersion ? ` (latest on verified-skill.com: ${d.latestVersion})` : "") +
    "; recorded as UNSCANNED."
  );
}

export function printTierDecision(name: string, d: RegistryTierDecision): void {
  if (d.tier === "VERIFIED") {
    console.log(dim(`  Matches verified-skill.com version ${d.matchedVersion}: VERIFIED`));
    return;
  }
  const note = tierNote(name, d);
  if (note) console.log(yellow(`  ${note}`));
}
