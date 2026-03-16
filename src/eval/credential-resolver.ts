// ---------------------------------------------------------------------------
// credential-resolver.ts -- resolve credentials from env -> .env.local chain
// ---------------------------------------------------------------------------

import { readFileSync, existsSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

export interface CredentialResult {
  value: string;
  source: "env" | "dotenv";
}

export interface CredentialStatus {
  name: string;
  status: "ready" | "missing" | "untested";
  source?: "env" | "dotenv";
}

/**
 * Resolve a single credential by name through the chain:
 *   1. process.env[name]
 *   2. .env.local in skillDir (parsed via dotenv-style parsing, not config())
 *
 * Returns null if not found in any source.
 */
export function resolveCredential(
  name: string,
  skillDir: string,
): CredentialResult | null {
  // 1. Check process.env
  const envVal = process.env[name];
  if (envVal !== undefined && envVal !== "") {
    return { value: envVal, source: "env" };
  }

  // 2. Check .env.local
  const dotenvPath = join(skillDir, ".env.local");
  if (existsSync(dotenvPath)) {
    const parsed = parseDotenv(readFileSync(dotenvPath, "utf-8"));
    const dotenvVal = parsed[name];
    if (dotenvVal !== undefined && dotenvVal !== "") {
      return { value: dotenvVal, source: "dotenv" };
    }
  }

  return null;
}

/**
 * Resolve multiple credentials and return their statuses.
 */
export function resolveAllCredentials(
  names: string[],
  skillDir: string,
): CredentialStatus[] {
  return names.map((name) => {
    const result = resolveCredential(name, skillDir);
    if (result) {
      return { name, status: "ready" as const, source: result.source };
    }
    return { name, status: "missing" as const };
  });
}

/**
 * Write a credential to .env.local, creating the file if needed.
 * Also ensures .env.local is in .gitignore.
 */
export function writeCredential(
  skillDir: string,
  key: string,
  value: string,
): void {
  const dotenvPath = join(skillDir, ".env.local");

  // Read existing content or start fresh
  let content = "";
  if (existsSync(dotenvPath)) {
    content = readFileSync(dotenvPath, "utf-8");
  }

  // Check if key already exists — replace it
  const lines = content.split("\n");
  const keyPattern = new RegExp(`^${escapeRegex(key)}=`);
  const existingIndex = lines.findIndex((line) => keyPattern.test(line));

  if (existingIndex >= 0) {
    lines[existingIndex] = `${key}=${value}`;
    writeFileSync(dotenvPath, lines.join("\n"), "utf-8");
  } else {
    // Append new entry
    const suffix = content.endsWith("\n") || content === "" ? "" : "\n";
    appendFileSync(dotenvPath, `${suffix}${key}=${value}\n`, "utf-8");
  }

  // Ensure .env.local is in .gitignore
  ensureGitignore(skillDir);
}

/**
 * Ensure .env.local is listed in .gitignore.
 */
export function ensureGitignore(skillDir: string): void {
  const gitignorePath = join(skillDir, ".gitignore");
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    if (content.split("\n").some((line) => line.trim() === ".env.local")) {
      return; // already present
    }
    const suffix = content.endsWith("\n") ? "" : "\n";
    appendFileSync(gitignorePath, `${suffix}.env.local\n`, "utf-8");
  } else {
    writeFileSync(gitignorePath, ".env.local\n", "utf-8");
  }
}

// ---------------------------------------------------------------------------
// Simple .env parser (does NOT mutate process.env)
// ---------------------------------------------------------------------------

export function parseDotenv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex < 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let val = trimmed.slice(eqIndex + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
