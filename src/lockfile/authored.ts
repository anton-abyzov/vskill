/**
 * Authored-skill tracking.
 *
 * Records skills that the current user has *published* (as opposed to
 * *installed*). Source-origin skills don't appear in `vskill.lock` (only
 * installs do), so without a separate manifest the `vskill outdated`
 * poll silently ignores them — leaving publishers blind to their own
 * downstream version drift (project_vskill_source_origin_update_tracking.md).
 *
 * File: `vskill.authored.json` at project root.
 *
 * Increment 0794 — US-006 / T-006.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const FILE_NAME = "vskill.authored.json";
const SCHEMA_VERSION = 1;

export interface AuthoredEntry {
  /** Fully-qualified registry name, e.g. "owner/repo/skill". */
  name: string;
  /** Absolute or project-relative path to the source SKILL.md. */
  sourcePath: string;
  /** ISO timestamp of the most recent successful publish. */
  publishedAt: string;
}

interface AuthoredFile {
  version: number;
  skills: Record<string, Omit<AuthoredEntry, "name">>;
}

function authoredPath(projectRoot: string): string {
  return join(projectRoot, FILE_NAME);
}

function emptyFile(): AuthoredFile {
  return { version: SCHEMA_VERSION, skills: {} };
}

function readFile(projectRoot: string): AuthoredFile {
  const filePath = authoredPath(projectRoot);
  if (!existsSync(filePath)) return emptyFile();
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    // Backward-compatible read: tolerate older shapes.
    if (parsed && typeof parsed === "object" && parsed.skills && typeof parsed.skills === "object") {
      return {
        version: typeof parsed.version === "number" ? parsed.version : SCHEMA_VERSION,
        skills: parsed.skills as AuthoredFile["skills"],
      };
    }
    return emptyFile();
  } catch {
    return emptyFile();
  }
}

function writeFile(projectRoot: string, file: AuthoredFile): void {
  const filePath = authoredPath(projectRoot);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(file, null, 2) + "\n");
}

/**
 * Insert or update an authored-skill entry. Idempotent: same name on the
 * same source path is a no-op except for refreshing `publishedAt`.
 */
export function addAuthoredSkill(
  projectRoot: string,
  name: string,
  sourcePath: string,
  publishedAt?: string,
): void {
  const file = readFile(projectRoot);
  file.skills[name] = {
    sourcePath,
    publishedAt: publishedAt ?? new Date().toISOString(),
  };
  writeFile(projectRoot, file);
}

/**
 * Remove an authored-skill entry. No-op when the name is absent.
 */
export function removeAuthoredSkill(projectRoot: string, name: string): void {
  const file = readFile(projectRoot);
  if (!(name in file.skills)) return;
  delete file.skills[name];
  writeFile(projectRoot, file);
}

/**
 * Read all authored entries as a flat array. Returns `[]` when the
 * `vskill.authored.json` file is missing or unreadable (graceful degrade).
 */
export function readAuthored(projectRoot: string): AuthoredEntry[] {
  const file = readFile(projectRoot);
  return Object.entries(file.skills).map(([name, entry]) => ({
    name,
    sourcePath: entry.sourcePath,
    publishedAt: entry.publishedAt,
  }));
}
