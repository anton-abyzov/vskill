// ---------------------------------------------------------------------------
// vskill clone — provenance-fork
// ---------------------------------------------------------------------------
// Thin helper around the existing `writeProvenance` / `readProvenance`
// primitives in src/studio/lib/provenance.ts. Computes the `forkedFrom`,
// `originalSource`, and `forkChain` fork-lineage fields for a cloned skill,
// then delegates the write to `writeProvenance` so the on-disk format is
// unchanged.
//
// Lineage rules (settled in plan.md §3 + spec AC-US5-02):
//   - `forkedFrom` always refers to the IMMEDIATE parent we just copied from.
//   - `forkChain[]` is the ancestry trail. When the source was already a fork
//     (i.e. its existing sidecar has a `forkedFrom`), append the source's
//     `forkedFrom.source` to the source's prior `forkChain[]`. When the
//     source was a root (no sidecar or no `forkedFrom`), `forkChain` is left
//     undefined.
//   - `originalSource` is carried forward unchanged from the source's sidecar
//     when present (it always points to the chain's deepest known ancestor).
//
// Existing `Provenance` fields written by other vskill flows
// (`promotedFrom`, `sourcePath`, `promotedAt`, `sourceSkillVersion`) are
// preserved when present on the source's sidecar, with sensible defaults
// for fresh clones.
//
// See ADR 0688-02 (sidecar provenance) for the underlying contract.
// ---------------------------------------------------------------------------

import { readProvenance, writeProvenance } from "../studio/lib/provenance.js";
import type { Provenance } from "../studio/types.js";
import type { ForkProvenance } from "./types.js";

export interface WriteForkProvenanceArgs {
  /** Where to write the .vskill-meta.json (typically the .tmp staging dir). */
  targetSkillDir: string;
  /** New `forkedFrom` record describing the immediate parent. */
  forkedFrom: ForkProvenance;
  /** Optional pre-read source provenance — when omitted, the helper reads it from `sourceSkillDir`. */
  sourceProvenance?: Provenance | null;
  /** Source skill directory. Used to read prior sidecar when `sourceProvenance` is not supplied. */
  sourceSkillDir?: string;
  /** Source absolute path — recorded as `sourcePath` for compatibility with the existing schema. */
  sourcePath: string;
  /** Source version — recorded as `sourceSkillVersion`. */
  sourceVersion?: string;
}

/**
 * Compute the merged Provenance object for a fresh fork without writing.
 * Exposed for unit tests and dry-run mode.
 */
export function computeForkProvenance(args: {
  forkedFrom: ForkProvenance;
  sourceProvenance: Provenance | null;
  sourcePath: string;
  sourceVersion?: string;
}): Provenance {
  const { forkedFrom, sourceProvenance, sourcePath, sourceVersion } = args;

  const next: Provenance = {
    // The existing schema requires these — for a brand-new fork the sensible
    // defaults are "global" (the cloned skill is now globally-authored by the
    // new author) and a fresh timestamp. When the source has its own sidecar,
    // we DO NOT inherit its `promotedFrom`/`sourcePath` because those refer
    // to the source's own promotion lineage, not the fork's.
    promotedFrom: "global",
    sourcePath,
    promotedAt: Date.now(),
    sourceSkillVersion: sourceVersion ?? forkedFrom.version,
    forkedFrom: { ...forkedFrom },
  };

  if (!sourceProvenance) {
    // Source is a root (no prior sidecar) — no forkChain, no originalSource.
    return next;
  }

  // Carry forward originalSource unchanged when present. It always points to
  // the chain's deepest known ancestor, so it is invariant under forking.
  if (sourceProvenance.originalSource) {
    next.originalSource = { ...sourceProvenance.originalSource };
  }

  if (sourceProvenance.forkedFrom) {
    // Source itself was a fork — extend the chain by its `forkedFrom.source`.
    // Order: oldest-first (the deepest ancestor is `forkChain[0]`, the most
    // recent intermediate parent — i.e. the source's own forkedFrom — is the
    // last entry). This ordering is consistent across rounds because each
    // clone appends only one entry.
    const priorChain = Array.isArray(sourceProvenance.forkChain)
      ? [...sourceProvenance.forkChain]
      : [];
    priorChain.push(sourceProvenance.forkedFrom.source);
    next.forkChain = priorChain;

    // If the source had no `originalSource` recorded but did have a chain,
    // synthesize one pointing at the chain head (best available ancestor).
    if (!next.originalSource && priorChain.length > 0) {
      next.originalSource = { skillPath: priorChain[0] };
    }
  }

  return next;
}

/**
 * Read the source skill's existing `.vskill-meta.json` (if any), compute the
 * merged fork provenance, and write it to the target directory's sidecar.
 *
 * The write is delegated to `writeProvenance` so the on-disk JSON shape is
 * identical to every other vskill flow that produces a sidecar.
 */
export async function writeForkProvenance(args: WriteForkProvenanceArgs): Promise<Provenance> {
  let sourceProvenance = args.sourceProvenance ?? null;
  if (sourceProvenance === undefined || (sourceProvenance === null && args.sourceSkillDir)) {
    if (args.sourceSkillDir) {
      sourceProvenance = await readProvenance(args.sourceSkillDir);
    }
  }

  const merged = computeForkProvenance({
    forkedFrom: args.forkedFrom,
    sourceProvenance,
    sourcePath: args.sourcePath,
    sourceVersion: args.sourceVersion,
  });

  await writeProvenance(args.targetSkillDir, merged);
  return merged;
}
