// ---------------------------------------------------------------------------
// ops-log — append-only JSONL log of studio file-changing operations
// ---------------------------------------------------------------------------
// Plan.md §2.2 / AC-US4-01 / AC-US4-04 / AC-US4-05.
//
// File: ~/.vskill/studio-ops.jsonl (override via VSKILL_OPS_LOG_PATH env).
// Atomicity: openSync(O_APPEND | O_WRONLY | O_CREAT) + single writeSync of a
// newline-terminated line. POSIX guarantees writes < PIPE_BUF (4 KiB) are
// atomic with O_APPEND — our ops are well under.
//
// In-process subscribe()/listOps()/deleteOp() (tombstone) — no cross-process IPC.
// ---------------------------------------------------------------------------

import { promises as fs, existsSync, statSync, renameSync } from "node:fs";
import type * as fsPromisesNS from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { EventEmitter } from "node:events";

import type { StudioOp } from "../types.js";

const emitter = new EventEmitter();
// Subscriber count is bounded by active SSE clients (~UI tabs); 100 is far
// above realistic load, and unlike `setMaxListeners(0)` it lets a real leak
// surface as a Node warning instead of silently growing.
emitter.setMaxListeners(100);

// Default rotation threshold for studio-ops.jsonl. Override via env to tune
// for long-running studios. 5 MiB ≈ ~25k ops at ~200 B each.
const ROTATE_BYTES_DEFAULT = 5 * 1024 * 1024;

function getRotateBytes(): number {
  const raw = process.env.VSKILL_OPS_LOG_ROTATE_BYTES;
  if (!raw) return ROTATE_BYTES_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : ROTATE_BYTES_DEFAULT;
}

export function getLogPath(): string {
  return process.env.VSKILL_OPS_LOG_PATH || join(homedir(), ".vskill", "studio-ops.jsonl");
}

async function ensureDir(path: string): Promise<void> {
  // mkdir(recursive:true) is idempotent — no need for an existsSync TOCTOU pre-check.
  await fs.mkdir(dirname(path), { recursive: true });
}

/**
 * Rotate `studio-ops.jsonl` → `studio-ops.1.jsonl` when the live log exceeds
 * the configured threshold. Best-effort: a rotation failure must not block
 * the append. Compaction of tombstones happens implicitly because rotated
 * files are kept (only `listOps` reads the live file; rotated history is
 * forensic-only, not surfaced via the API).
 */
function maybeRotate(path: string): void {
  try {
    if (!existsSync(path)) return;
    const size = statSync(path).size;
    if (size < getRotateBytes()) return;
    renameSync(path, path.replace(/\.jsonl$/, ".1.jsonl"));
  } catch {
    /* rotation is best-effort */
  }
}

export async function appendOp(op: StudioOp): Promise<void> {
  const path = getLogPath();
  await ensureDir(path);
  maybeRotate(path);
  const line = JSON.stringify(op) + "\n";
  // POSIX guarantees writes < PIPE_BUF (4 KiB) are atomic with O_APPEND;
  // our ops are well under that. fs.appendFile uses O_APPEND under the hood.
  await fs.appendFile(path, line);
  emitter.emit("op", op);
}

interface TombstoneLine {
  id: string;
  tombstone: true;
}

export interface ListOpsOptions {
  before?: number;
  limit?: number;
}

const TAIL_CHUNK_BYTES = 64 * 1024;
const DEFAULT_LIMIT = 50;

/**
 * Read JSONL backwards from EOF in 64 KiB chunks until we have `limit`
 * non-tombstoned ops or hit the start of the file. Tombstones are appended
 * AFTER the op they invalidate, so reading newest-first naturally surfaces
 * tombstone IDs before the ops they apply to.
 *
 * Memory: O(chunk + limit). Time: O(limit) for typical limits (50–500),
 * vs. O(file-size) for the previous full-file approach.
 */
async function readTailOps(
  path: string,
  limit: number,
  before: number | undefined,
): Promise<StudioOp[]> {
  let fh: fsPromisesNS.FileHandle;
  try {
    fh = await fs.open(path, "r");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  try {
    const { size } = await fh.stat();
    if (size === 0) return [];

    const tombstoned = new Set<string>();
    const ops: StudioOp[] = [];
    let pos = size;
    let carry = ""; // Partial line stitched onto the next (older) chunk.

    while (pos > 0 && ops.length < limit) {
      const readLen = Math.min(TAIL_CHUNK_BYTES, pos);
      pos -= readLen;
      const buf = Buffer.alloc(readLen);
      await fh.read(buf, 0, readLen, pos);

      // chunk_text + carry from previous (newer) chunk = continuous bytes,
      // because chunks are read newest→oldest and `carry` was the partial
      // line at the START of the previous chunk.
      const text = buf.toString("utf-8") + carry;

      // The first newline splits a partial line at the start of `text`
      // (which continues into older bytes still on disk) from complete
      // lines after it. At pos === 0 there is no older data — every
      // segment is a complete line.
      let firstNL: number;
      let lines: string[];
      if (pos === 0) {
        carry = "";
        lines = text.split("\n");
      } else {
        firstNL = text.indexOf("\n");
        if (firstNL === -1) {
          // No newline at all — the entire chunk continues into older bytes.
          carry = text;
          continue;
        }
        carry = text.slice(0, firstNL);
        lines = text.slice(firstNL + 1).split("\n");
      }

      // Process newest→oldest within this batch.
      for (let i = lines.length - 1; i >= 0 && ops.length < limit; i--) {
        const trimmed = lines[i].trim();
        if (!trimmed) continue;
        let parsed: StudioOp | TombstoneLine;
        try { parsed = JSON.parse(trimmed); } catch { continue; }

        if ((parsed as TombstoneLine).tombstone === true) {
          const id = (parsed as TombstoneLine).id;
          if (id) tombstoned.add(id);
          continue;
        }
        const op = parsed as StudioOp;
        if (typeof op.ts !== "number") continue;
        if (tombstoned.has(op.id)) continue;
        if (before != null && op.ts >= before) continue;
        ops.push(op);
      }
    }

    // Tail-read order is approximately newest-first but `ts` may not be
    // strictly monotonic w.r.t. file position (clock skew, parallel writes
    // — both rare but possible). Re-sort to honor the contract.
    ops.sort((a, b) => b.ts - a.ts);
    return ops.slice(0, limit);
  } finally {
    await fh.close();
  }
}

export async function listOps(opts: ListOpsOptions = {}): Promise<StudioOp[]> {
  const path = getLogPath();
  const limit = opts.limit ?? DEFAULT_LIMIT;
  return readTailOps(path, limit, opts.before);
}

export function subscribe(fn: (op: StudioOp) => void): () => void {
  emitter.on("op", fn);
  return () => emitter.off("op", fn);
}

export async function deleteOp(id: string): Promise<void> {
  const path = getLogPath();
  await ensureDir(path);
  maybeRotate(path);
  const line = JSON.stringify({ id, tombstone: true } satisfies TombstoneLine) + "\n";
  await fs.appendFile(path, line);
  emitter.emit("delete", id);
}
