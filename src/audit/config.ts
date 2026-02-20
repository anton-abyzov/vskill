/**
 * Audit configuration loader.
 *
 * Loads config from .vskill-audit.json or .vskillrc, merges with defaults,
 * then applies CLI flag overrides.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createDefaultAuditConfig, type AuditConfig, type Severity } from "./audit-types.js";

const VALID_SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];

const CONFIG_FILES = [".vskill-audit.json", ".vskillrc"] as const;

/**
 * Try to read and parse a JSON config file. Returns null if not found.
 */
async function tryLoadJsonFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Load audit configuration by merging defaults, config file, and CLI overrides.
 *
 * Priority: CLI flags > config file > defaults
 */
export async function loadAuditConfig(
  rootPath: string,
  cliOverrides: Record<string, string | undefined>,
): Promise<AuditConfig> {
  const config = createDefaultAuditConfig();

  // Try config files in order
  let fileConfig: Record<string, unknown> | null = null;
  for (const name of CONFIG_FILES) {
    fileConfig = await tryLoadJsonFile(join(rootPath, name));
    if (fileConfig) break;
  }

  // Merge file config into defaults
  if (fileConfig) {
    if (Array.isArray(fileConfig.excludePaths)) {
      config.excludePaths = fileConfig.excludePaths as string[];
    }
    if (typeof fileConfig.maxFiles === "number") {
      config.maxFiles = fileConfig.maxFiles;
    }
    if (typeof fileConfig.maxFileSize === "number") {
      config.maxFileSize = fileConfig.maxFileSize;
    }
    if (typeof fileConfig.severityThreshold === "string") {
      config.severityThreshold = fileConfig.severityThreshold as Severity;
    }
    if (typeof fileConfig.tier1Only === "boolean") {
      config.tier1Only = fileConfig.tier1Only;
    }
    if (typeof fileConfig.fix === "boolean") {
      config.fix = fileConfig.fix;
    }
    if (typeof fileConfig.llmProvider === "string") {
      config.llmProvider = fileConfig.llmProvider;
    }
    if (typeof fileConfig.llmTimeout === "number") {
      config.llmTimeout = fileConfig.llmTimeout;
    }
    if (typeof fileConfig.llmConcurrency === "number") {
      config.llmConcurrency = fileConfig.llmConcurrency;
    }
  }

  // Apply CLI overrides
  if (cliOverrides.maxFiles !== undefined) {
    config.maxFiles = Number(cliOverrides.maxFiles);
  }
  if (cliOverrides.severity !== undefined) {
    const sev = cliOverrides.severity as Severity;
    if (!VALID_SEVERITIES.includes(sev)) {
      throw new Error(`Invalid severity: "${cliOverrides.severity}". Valid values: ${VALID_SEVERITIES.join(", ")}`);
    }
    config.severityThreshold = sev;
  }
  if (cliOverrides.tier1Only !== undefined) {
    config.tier1Only = cliOverrides.tier1Only === "true";
  }
  if (cliOverrides.fix !== undefined) {
    config.fix = cliOverrides.fix === "true";
  }
  if (cliOverrides.exclude !== undefined) {
    config.excludePaths = cliOverrides.exclude.split(",").map((p) => p.trim());
  }

  return config;
}
