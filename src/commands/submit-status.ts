// ---------------------------------------------------------------------------
// Follow a public submission on verified-skill.com: poll
// GET /api/v1/submissions/{id}, print each state change, stop on a terminal
// state or after a ceiling, and exit 1 when the scan rejected the skill.
// ---------------------------------------------------------------------------

import { getSubmission, type SubmissionDetail, type SubmissionFinding } from "../api/client.js";
import { bold, cyan, dim, green, red, yellow } from "../utils/output.js";

/**
 * Final states (vskill-platform pipeline/submission-machine.ts). AUTO_APPROVED
 * and VENDOR_APPROVED are not final: both move on to PUBLISHED (the publish
 * step, or queue/recovery.ts for one that stalled), so polling continues
 * through them. EXPANDED ends a multi-skill submission that was split into
 * one submission per skill.
 */
const SUCCESS_STATES = new Set(["PUBLISHED", "EXPANDED"]);
/** Rejected, failed, dequeued or blocked: never published. */
export const FAILED_STATES: ReadonlySet<string> = new Set(["REJECTED", "TIER1_FAILED", "DEQUEUED", "BLOCKED"]);

export const DEFAULT_POLL_INTERVAL_MS = 3_000;
export const DEFAULT_WAIT_CEILING_MS = 5 * 60_000;
const MAX_FINDINGS_PRINTED = 10;

export interface FollowOptions {
  /** Poll until terminal instead of printing the current state once. */
  wait?: boolean;
  intervalMs?: number;
  ceilingMs?: number;
  /** Injected in tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** A failed result never returns: followSubmission exits 1 instead. */
export type FollowOutcome = "published" | "expanded" | "pending";

export interface FollowResult {
  outcome: FollowOutcome;
  /** The last submission detail read, or null when none could be read. */
  detail: SubmissionDetail | null;
}

function isPermanentClientError(status: number | undefined): boolean {
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export function isTerminalState(state: string | undefined): boolean {
  return !!state && (SUCCESS_STATES.has(state) || FAILED_STATES.has(state));
}

/**
 * Print a submission's state (and follow it with `wait`). Calls
 * process.exit(1) on a rejected, failed, dequeued or blocked result and when
 * the submission cannot be read at all.
 */
export async function followSubmission(id: string, opts: FollowOptions = {}): Promise<FollowResult> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const interval = opts.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = now() + (opts.ceilingMs ?? DEFAULT_WAIT_CEILING_MS);

  let detail: SubmissionDetail | null = null;
  let lastState: string | undefined;
  let lastError: string | null = null;

  for (;;) {
    try {
      detail = await getSubmission(id);
      lastError = null;
      if (detail.state !== lastState) {
        console.log(`${dim("Submission")} ${id}: ${bold(detail.state)}`);
        lastState = detail.state;
      }
    } catch (err) {
      const msg = (err as Error).message.slice(0, 200);
      const status = (err as { status?: number }).status;
      // A missing id never appears later; stop instead of polling a 404.
      if (status === 404) {
        console.error(red(`Submission ${id} was not found on verified-skill.com.`));
        process.exit(1);
      }
      // Other client errors (400, 401, 403...) repeat on every poll; only 5xx,
      // 408, 429 and network errors are worth retrying.
      if (isPermanentClientError(status)) {
        console.error(red("Could not read the submission: ") + dim(msg));
        process.exit(1);
      }
      if (!detail && !opts.wait) {
        console.error(red("Could not read the submission: ") + dim(msg));
        process.exit(1);
      }
      if (msg !== lastError) console.log(dim(`(status check failed, retrying: ${msg})`));
      lastError = msg;
    }

    if (detail && isTerminalState(detail.state)) break;
    if (!opts.wait || now() + interval > deadline) break;
    await sleep(interval);
  }

  if (!detail || !isTerminalState(detail.state)) {
    console.log(
      yellow("Still processing. ") +
        dim("Check again with: ") +
        cyan(`vskill submit --submission ${id} --wait`),
    );
    return { outcome: "pending", detail };
  }

  if (detail.state === "EXPANDED") {
    console.log(green("Accepted. ") + dim("The repository's skills were split into one submission each."));
    return { outcome: "expanded", detail };
  }

  if (SUCCESS_STATES.has(detail.state)) {
    const name = detail.publishedSkillName ?? null;
    console.log(green("Verified. ") + (name ? dim(`Published as ${name}.`) : ""));
    if (name) console.log(dim("Install with: ") + cyan(`vskill install ${name}`));
    return { outcome: "published", detail };
  }

  printRejection(detail);
  process.exit(1);
}

function printRejection(detail: SubmissionDetail): void {
  console.error(red(`Not published: ${detail.state}.`));
  if (detail.blockInfo?.reason) console.error(dim(`Reason: ${detail.blockInfo.reason}`));
  const scan = detail.scanResult;
  if (scan?.verdict || scan?.score != null) {
    console.error(dim(`Scan: tier ${scan.tier ?? "?"}, verdict ${scan.verdict ?? "?"}, score ${scan.score ?? "?"}`));
  }
  const findings = [...(scan?.findings ?? []), ...(detail.blockInfo?.findings ?? [])];
  for (const f of findings.slice(0, MAX_FINDINGS_PRINTED)) console.error("  " + formatFinding(f));
  if (findings.length > MAX_FINDINGS_PRINTED) {
    console.error(dim(`  ...and ${findings.length - MAX_FINDINGS_PRINTED} more`));
  }
  console.error(dim("Fix the findings, push the change, then run vskill submit again."));
}

export function formatFinding(f: SubmissionFinding): string {
  const severity = (f.severity ?? "info").toString().toUpperCase();
  const title = f.patternName ?? f.title ?? f.message ?? f.patternId ?? f.category ?? "finding";
  const where = f.file ? `${f.file}${f.lineNumber ? `:${f.lineNumber}` : ""}` : f.lineNumber ? `line ${f.lineNumber}` : "";
  return `${severity} ${title}${where ? dim(` (${where})`) : ""}`;
}
