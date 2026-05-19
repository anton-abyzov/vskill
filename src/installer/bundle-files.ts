import { promises as fs } from "node:fs";
import { isAbsolute, join, relative, sep as pathSep } from "node:path";

const STANDARD_BUNDLE_PREFIXES = [
  "agents/",
  "scripts/",
  "references/",
  "assets/",
  "tests/",
] as const;

const STANDARD_ROOT_FILES = new Set([".env.example"]);

function normalizeBundlePath(relPath: string): string {
  return relPath.replace(/\\/g, "/");
}

function isStandardBundlePath(relPath: string): boolean {
  return (
    STANDARD_ROOT_FILES.has(relPath) ||
    STANDARD_BUNDLE_PREFIXES.some((prefix) => relPath.startsWith(prefix))
  );
}

export function assertSafeBundlePath(relPath: string): string {
  if (typeof relPath !== "string" || relPath.trim() === "") {
    throw new Error("Bundled skill file path cannot be empty");
  }
  if (relPath.includes("\0")) {
    throw new Error(`Bundled skill file path contains a NUL byte: ${relPath}`);
  }

  const normalized = normalizeBundlePath(relPath.trim());
  if (normalized === "SKILL.md") {
    throw new Error("Bundled skill files must not include SKILL.md");
  }
  if (isAbsolute(normalized) || normalized.startsWith("/")) {
    throw new Error(`Bundled skill file path must be relative: ${relPath}`);
  }

  const parts = normalized.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`Bundled skill file path escapes the skill directory: ${relPath}`);
  }
  if (!isStandardBundlePath(normalized)) {
    throw new Error(
      `Unsupported bundled skill file path: ${relPath}. Expected agents/, scripts/, references/, assets/, tests/, or .env.example`,
    );
  }
  return normalized;
}

export function resolveBundleTarget(root: string, relPath: string): string {
  const normalized = assertSafeBundlePath(relPath);
  const target = join(root, ...normalized.split("/"));
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(".." + pathSep) || rel.startsWith("../")) {
    throw new Error(`Bundled skill file path escapes install root: ${relPath}`);
  }
  return target;
}

export function sanitizeSkillBundleFiles(files: unknown): Record<string, string> {
  if (files === undefined || files === null) return {};
  if (typeof files !== "object" || Array.isArray(files)) {
    throw new Error("Bundled skill files must be an object keyed by relative path");
  }

  const out: Record<string, string> = {};
  for (const [rawPath, content] of Object.entries(files as Record<string, unknown>)) {
    const relPath = assertSafeBundlePath(rawPath);
    if (typeof content !== "string") {
      throw new Error(`Bundled skill file ${rawPath} must have string content`);
    }
    out[relPath] = content;
  }
  return out;
}

export async function collectSkillBundleFiles(skillDir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};

  async function walk(dir: string, relBase = ""): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
      const absPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        const normalized = normalizeBundlePath(relPath);
        if (STANDARD_BUNDLE_PREFIXES.some((prefix) => prefix.startsWith(`${normalized}/`) || normalized.startsWith(prefix))) {
          await walk(absPath, normalized);
        }
        continue;
      }

      if (!entry.isFile()) continue;
      if (relPath === "SKILL.md") continue;

      let safePath: string;
      try {
        safePath = assertSafeBundlePath(relPath);
      } catch {
        continue;
      }
      files[safePath] = await fs.readFile(absPath, "utf-8");
    }
  }

  await walk(skillDir);
  return files;
}
