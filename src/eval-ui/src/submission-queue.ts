// ---------------------------------------------------------------------------
// submission-queue.ts — DTOs for the in-app submission queue (moved out of
// api.ts, which is over the file-size limit) and the typed "not submitted"
// error api.submitToQueue throws.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 0856 — In-app submission queue DTOs.
//
// Source of truth: vskill-platform `/api/v1/submissions` (POST + GET) and
// `/api/v1/submissions/positions`. Mirrored here so eval-ui compiles
// standalone (same pattern as the tenant DTOs below). These ride the
// eval-server platform proxy (`/api/v1/submissions` is in PROXY_PREFIXES),
// so the WebView issues same-origin relative requests and the X-Studio-Token
// bridge handles auth — no token plumbing in the UI.
// ---------------------------------------------------------------------------

/** Terminal + transient submission states (mirror of platform SubmissionState). */
export type SubmissionState =
  | "RECEIVED"
  | "TIER1_SCANNING"
  | "TIER1_FAILED"
  | "TIER2_SCANNING"
  | "AUTO_APPROVED"
  | "PUBLISHED"
  | "REJECTED"
  | "VENDOR_APPROVED"
  | "DEQUEUED"
  | "RESCAN_REQUIRED"
  | "EXPANDED"
  | "BLOCKED";

/** One row in the GET /api/v1/submissions list response. */
export interface SubmissionRow {
  id: string;
  skillName: string;
  repoUrl: string;
  state: SubmissionState | string;
  priority?: number;
  createdAt: string;
  updatedAt: string;
}

/** GET /api/v1/submissions response envelope (subset the Studio consumes). */
export interface SubmissionListResponse {
  submissions: SubmissionRow[];
  total?: number;
  /** Map of submissionId → queue position. Present on the active feed. */
  queuePositions?: Record<string, number> | null;
}

/** POST /api/v1/submissions body for a single-skill in-app submit. */
export interface SubmitToQueueBody {
  repoUrl: string;
  skillName: string;
  skillPath?: string;
  /** Free-form attribution string, e.g. "studio-submit". */
  source?: string;
  privacy?: "public" | "private" | "decide-later" | string;
  /** Required by the platform when privacy === "private". */
  tenantId?: string;
}

/**
 * Discriminated outcomes of POST /api/v1/submissions (single-skill path).
 * The platform returns a different flat JSON body per branch — the UI renders
 * a structured inline outcome from this so a submit never looks like a no-op.
 */
export type SubmitToQueueResult =
  | { kind: "created"; id: string; skillName: string; skillPath: string; state: string; createdAt: string }
  | { kind: "duplicate"; id: string; state: string }
  | { kind: "alreadyVerified"; skillId?: string; skillName?: string }
  | { kind: "requeued"; id: string; state: string }
  | { kind: "blocked"; submissionId: string };

/** GET /api/v1/submissions/positions response. */
export interface SubmissionPositionsResponse {
  positions: Record<string, number>;
  total: number;
}

// ---------------------------------------------------------------------------
// 0874 AC-06 / AC-07 — "not submitted" refusals.
//
// Two sources, one shape: the local eval-server proxy refuses a private or
// unconfirmed repo with 422 (private_repository / unsupported_repository)
// before anything leaves the machine, and verified-skill.com answers 503 while
// hosted private publishing is closed. In both cases the push succeeded,
// nothing was submitted, and signing in or opening the website would not help,
// so callers show `message` instead of the sign-in / website fallback.
// ---------------------------------------------------------------------------

export type SubmissionRefusalCode =
  | "private_repository"
  | "unsupported_repository"
  | "private_publishing_unavailable"
  | "draft_persistence_unavailable";

const LOCAL_REFUSAL_CODES: ReadonlySet<string> = new Set(["private_repository", "unsupported_repository"]);
// verified-skill.com's launch-gate answers (see hosted-publishing.ts).
const LAUNCH_GATE_CODES: ReadonlySet<string> = new Set([
  "private_publishing_unavailable",
  "draft_persistence_unavailable",
]);

export class SubmissionRefusedError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "SubmissionRefusedError";
    this.code = code;
    this.status = status;
  }
}

/** True for a {@link SubmissionRefusedError}, also across module copies. */
export function isSubmissionRefusal(err: unknown): err is SubmissionRefusedError {
  return (
    err instanceof SubmissionRefusedError ||
    (err instanceof Error && err.name === "SubmissionRefusedError" && typeof (err as { code?: unknown }).code === "string")
  );
}

/**
 * Turn a submit failure into a {@link SubmissionRefusedError} when it is a
 * refusal; any other error is rethrown as is. Duck-typed on the ApiError
 * shape (`status` + forwarded JSON `details`) so this module does not import
 * api.ts.
 */
export function rethrowSubmissionRefusal(err: unknown): never {
  const e = err as { status?: unknown; details?: Record<string, unknown> } | null;
  const code = typeof e?.details?.error === "string" ? e.details.error : "";
  const message = typeof e?.details?.message === "string" ? e.details.message : "";
  if (e?.status === 400 && code === "missing_tenant") {
    throw new SubmissionRefusedError(code, message || "Select a publishing account or connect the GitHub App first.", 400);
  }
  if (e?.status === 422 && LOCAL_REFUSAL_CODES.has(code)) {
    throw new SubmissionRefusedError(code, message || "Nothing was submitted to verified-skill.com.", 422);
  }
  if (e?.status === 503 && LAUNCH_GATE_CODES.has(code)) {
    throw new SubmissionRefusedError(code, message || "Hosted private publishing is not open yet.", 503);
  }
  throw err;
}
