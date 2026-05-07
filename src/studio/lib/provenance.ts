// ---------------------------------------------------------------------------
// provenance — read/write/remove .vskill-meta.json sidecar in skill dirs
// ---------------------------------------------------------------------------
// See ADR 0688-02 (sidecar vs frontmatter). The sidecar enriches OWN rows
// for UI purposes only; it does NOT change scope classification.
//
// Read is best-effort: ENOENT or JSON parse error → returns null, never
// throws. This keeps the scanner robust against stale/corrupt files.
// ---------------------------------------------------------------------------

import { promises as fs } from "node:fs";
import { join } from "node:path";

import type { Provenance } from "../types.js";

const SIDECAR_NAME = ".vskill-meta.json";

export async function writeProvenance(skillDir: string, p: Provenance): Promise<void> {
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(join(skillDir, SIDECAR_NAME), JSON.stringify(p, null, 2), "utf-8");
}

export async function readProvenance(skillDir: string): Promise<Provenance | null> {
  try {
    const raw = await fs.readFile(join(skillDir, SIDECAR_NAME), "utf-8");
    return JSON.parse(raw) as Provenance;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      // Parse error or transient IO — emit a breadcrumb (matches the
      // best-effort pattern used elsewhere; caller still gets null).
      console.warn(`[provenance] readProvenance(${skillDir}) failed: ${(err as Error).message}`);
    }
    return null;
  }
}

export async function removeProvenance(skillDir: string): Promise<void> {
  try {
    await fs.unlink(join(skillDir, SIDECAR_NAME));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") throw err;
  }
}
