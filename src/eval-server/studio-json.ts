// ---------------------------------------------------------------------------
// studio-json.ts — Persistent agent/model selection at .vskill/studio.json.
//
// Format:
//   {
//     "activeAgent": "claude-code",
//     "activeModel": "sonnet",
//     "updatedAt": "2026-04-23T15:30:00.000Z"
//   }
//
// Writes are atomic: content goes to `.vskill/studio.json.tmp.<rand>`, then
// fs.rename swaps the final file. This survives crashes mid-write — readers
// either see the old file or the new one, never a truncation.
//
// Missing file → returns null (caller falls back to auto-detection defaults).
// Malformed file → logs a warning, returns null, rewrites on next save().
// ---------------------------------------------------------------------------

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export interface StudioSelection {
  activeAgent: string;
  activeModel: string;
  updatedAt: string;
}

const STUDIO_DIR = ".vskill";
const STUDIO_FILE = "studio.json";

function studioPath(root: string): string {
  return join(root, STUDIO_DIR, STUDIO_FILE);
}

/** Load the saved selection, or null if missing/malformed. */
export function loadStudioSelection(root: string): StudioSelection | null {
  const path = studioPath(root);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<StudioSelection>;
    if (
      typeof parsed.activeAgent !== "string" ||
      typeof parsed.activeModel !== "string"
    ) {
      console.warn(`[studio.json] Ignoring malformed ${path} — missing required fields`);
      return null;
    }
    return {
      activeAgent: parsed.activeAgent,
      activeModel: parsed.activeModel,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch (err) {
    console.warn(`[studio.json] Ignoring malformed ${path}: ${(err as Error).message}`);
    return null;
  }
}

/** Save the selection atomically (tmp file + rename). */
export async function saveStudioSelection(
  root: string,
  selection: StudioSelection,
): Promise<void> {
  const dir = join(root, STUDIO_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // 0682 F-004 (review iter 2): use a per-pid suffix in the tmp filename so
  // concurrent writers (multiple processes, or re-entrant calls) don't
  // delete each other's in-flight tmps. The orphan sweep skips files
  // matching this pid prefix to avoid racing against an in-flight write
  // we ourselves are about to land.
  const pidSuffix = `pid${process.pid}.`;
  // Sweep orphan .tmp siblings from a prior crash, but skip our own pid's
  // tmps — those are either ours-in-flight (next call) or from a concurrent
  // call by the same process and either way are not "orphans".
  try {
    for (const entry of readdirSync(dir)) {
      if (
        entry.startsWith(`${STUDIO_FILE}.tmp.`) &&
        !entry.includes(pidSuffix)
      ) {
        try {
          unlinkSync(join(dir, entry));
        } catch { /* best-effort */ }
      }
    }
  } catch { /* best-effort */ }

  const tmpPath = join(
    dir,
    `${STUDIO_FILE}.tmp.${pidSuffix}${randomBytes(4).toString("hex")}`,
  );
  const finalPath = studioPath(root);
  writeFileSync(tmpPath, JSON.stringify(selection, null, 2), "utf8");
  try {
    renameSync(tmpPath, finalPath);
  } catch (err) {
    try { unlinkSync(tmpPath); } catch { /* best-effort cleanup */ }
    throw err;
  }
}
