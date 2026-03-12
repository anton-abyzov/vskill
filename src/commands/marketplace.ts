// ---------------------------------------------------------------------------
// vskill marketplace sync — sync .claude-plugin/marketplace.json from plugins/
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { findProjectRoot } from "../utils/project-root.js";
import { syncMarketplace } from "../marketplace/index.js";
import type { LocalPlugin } from "../marketplace/index.js";
import { bold, green, yellow, dim, spinner, table } from "../utils/output.js";

interface MarketplaceSyncOpts {
  dryRun?: boolean;
  cwd?: string;
}

export async function marketplaceCommand(
  subcommand: string,
  opts: MarketplaceSyncOpts,
): Promise<void> {
  if (subcommand !== "sync") {
    console.error(`Unknown marketplace subcommand: ${subcommand}. Available: sync`);
    process.exit(1);
    return;
  }
  await syncCommand(opts);
}

async function syncCommand(opts: MarketplaceSyncOpts): Promise<void> {
  const root = opts.cwd
    ? resolve(opts.cwd)
    : (findProjectRoot(process.cwd()) ?? process.cwd());

  const marketplacePath = join(root, ".claude-plugin", "marketplace.json");

  if (!existsSync(marketplacePath)) {
    console.error(`marketplace.json not found at ${marketplacePath}`);
    process.exit(1);
    return;
  }

  const spin = spinner("Scanning plugins...");
  const pluginsDir = join(root, "plugins");
  const localPlugins: LocalPlugin[] = [];
  const skipped: string[] = [];

  if (existsSync(pluginsDir)) {
    for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pluginJsonPath = join(pluginsDir, entry.name, ".claude-plugin", "plugin.json");
      if (!existsSync(pluginJsonPath)) {
        skipped.push(entry.name);
        continue;
      }
      try {
        const meta = JSON.parse(readFileSync(pluginJsonPath, "utf-8") as string);
        localPlugins.push({
          name: entry.name,
          description: meta.description as string | undefined,
          version: meta.version as string | undefined,
          category: meta.category as string | undefined,
        });
      } catch {
        skipped.push(entry.name);
      }
    }
  }

  spin.stop();

  const manifestContent = readFileSync(marketplacePath, "utf-8") as string;
  let result;
  try {
    result = syncMarketplace(manifestContent, localPlugins);
  } catch {
    console.error(`marketplace.json is malformed JSON at ${marketplacePath}`);
    process.exit(1);
    return;
  }

  const rows: string[][] = [
    ...result.added.map((n) => [green("+ added"), n]),
    ...result.updated.map((n) => [yellow("~ updated"), n]),
    ...result.unchanged.map((n) => [dim("  unchanged"), n]),
  ];

  if (rows.length > 0) {
    console.log("\n" + table(["Status", "Plugin"], rows));
  }

  if (skipped.length > 0) {
    console.log(yellow(`\nSkipped (no plugin.json): ${skipped.join(", ")}`));
  }

  if (opts.dryRun) {
    console.log(dim("\n--dry-run: no changes written"));
    return;
  }

  if (result.added.length > 0 || result.updated.length > 0) {
    writeFileSync(
      marketplacePath,
      JSON.stringify(result.updatedManifest, null, 2) + "\n",
    );
    console.log(
      bold(
        `\n✓ marketplace.json updated (${result.added.length} added, ${result.updated.length} updated)`,
      ),
    );
  } else {
    console.log(dim("\n✓ marketplace.json already up to date"));
  }
}
