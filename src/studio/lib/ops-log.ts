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

import { openSync, writeSync, closeSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { EventEmitter } from "node:events";

import type { StudioOp } from "../types.js";

const APPEND_FLAGS = "a";
const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export function getLogPath(): string {
  return process.env.VSKILL_OPS_LOG_PATH || join(homedir(), ".vskill", "studio-ops.jsonl");
}

function ensureDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export async function appendOp(op: StudioOp): Promise<void> {
  const path = getLogPath();
  ensureDir(path);
  const line = JSON.stringify(op) + "\n";
  // Single openSync + writeSync + closeSync — atomic for small writes under POSIX O_APPEND.
  const fd = openSync(path, APPEND_FLAGS);
  try {
    writeSync(fd, line);
  } finally {
    closeSync(fd);
  }
  emitter.emit("op", op);
}

interface TombstoneLine {
  id: string;
  tombstone: true;
}

function readAllLines(path: string): (StudioOp | TombstoneLine)[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf-8");
  const out: (StudioOp | TombstoneLine)[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed line — log corruption shouldn't crash listOps.
    }
  }
  return out;
}

export interface ListOpsOptions {
  before?: number;
  limit?: number;
}

export async function listOps(opts: ListOpsOptions = {}): Promise<StudioOp[]> {
  const path = getLogPath();
  const all = readAllLines(path);
  const tombstoned = new Set<string>();
  for (const entry of all) {
    if ((entry as TombstoneLine).tombstone === true && (entry as TombstoneLine).id) {
      tombstoned.add((entry as TombstoneLine).id);
    }
  }
  let ops: StudioOp[] = all
    .filter((e): e is StudioOp => !(e as TombstoneLine).tombstone && typeof (e as StudioOp).ts === "number")
    .filter((op) => !tombstoned.has(op.id));

  // Newest first.
  ops.sort((a, b) => b.ts - a.ts);

  if (opts.before != null) {
    ops = ops.filter((op) => op.ts < opts.before!);
  }
  if (opts.limit != null) {
    ops = ops.slice(0, opts.limit);
  }
  return ops;
}

export function subscribe(fn: (op: StudioOp) => void): () => void {
  emitter.on("op", fn);
  return () => emitter.off("op", fn);
}

export async function deleteOp(id: string): Promise<void> {
  const path = getLogPath();
  ensureDir(path);
  const line = JSON.stringify({ id, tombstone: true } satisfies TombstoneLine) + "\n";
  const fd = openSync(path, APPEND_FLAGS);
  try {
    writeSync(fd, line);
  } finally {
    closeSync(fd);
  }
  emitter.emit("delete", id);
}
