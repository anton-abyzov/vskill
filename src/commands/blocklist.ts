// ---------------------------------------------------------------------------
// vskill blocklist -- manage the malicious skills blocklist
// ---------------------------------------------------------------------------

import {
  getCachedBlocklist,
  syncBlocklist,
  checkBlocklist,
} from "../blocklist/blocklist.js";
import { bold, green, red, dim, table } from "../utils/output.js";

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

async function listBlocklist(): Promise<void> {
  const cache = getCachedBlocklist();

  if (!cache) {
    console.log(
      dim("No cached blocklist. Run `vskill blocklist sync` first."),
    );
    return;
  }

  const ago = timeSince(new Date(cache.fetchedAt));
  console.log(
    bold(`Malicious Skills Blocklist (${cache.count} entries, last synced: ${ago})`),
  );
  console.log("");

  const headers = ["SKILL NAME", "THREAT TYPE", "SEVERITY", "SOURCE"];
  const rows = cache.entries.map((e) => [
    e.skillName,
    e.threatType,
    e.severity,
    e.sourceRegistry || e.sourceUrl || "-",
  ]);

  console.log(table(headers, rows));
}

async function syncBlocklistCmd(): Promise<void> {
  console.log(dim("Syncing blocklist from verified-skill.com..."));

  try {
    const cache = await syncBlocklist();
    console.log(
      green(`Synced ${cache.count} entries (last updated: ${cache.lastUpdated})`),
    );
  } catch (err) {
    console.error(
      red("Failed to sync blocklist: ") + dim((err as Error).message),
    );
  }
}

async function checkBlocklistCmd(name?: string): Promise<void> {
  if (!name) {
    console.error(red("Usage: vskill blocklist check <name>"));
    return;
  }

  const entry = await checkBlocklist(name);

  if (entry) {
    console.log(red(`"${name}" is BLOCKED`));
    console.log(red(`  Threat: ${entry.threatType} (${entry.severity})`));
    console.log(red(`  Reason: ${entry.reason}`));
    if (entry.sourceRegistry) {
      console.log(dim(`  Source: ${entry.sourceRegistry}`));
    }
  } else {
    console.log(green(`"${name}" is not blocklisted`));
  }
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function blocklistCommand(
  subcommand: string,
  name?: string,
): Promise<void> {
  switch (subcommand) {
    case "list":
      return listBlocklist();
    case "sync":
      return syncBlocklistCmd();
    case "check":
      return checkBlocklistCmd(name);
    default:
      console.error(
        red(`Unknown subcommand: "${subcommand}"\n`) +
          dim("Available: list, sync, check"),
      );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeSince(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
