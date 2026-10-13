// ---------------------------------------------------------------------------
// submission-guard.ts — screens Studio's `POST /api/v1/submissions` before the
// platform proxy forwards it to verified-skill.com (0874 AC-06).
//
// Public submissions require confirmed public GitHub visibility. Private
// submissions additionally require the hosted release gate, explicit private
// intent and a selected tenant; the platform rechecks all authorization and
// reads source only with that tenant's GitHub installation credential.
// Only the create call is screened; the stream and positions sub-resources
// carry no repo and pass through unchanged.
// ---------------------------------------------------------------------------

import type * as http from "node:http";
import { isPrivateOrUnknownRepo, parseGitHubRepoRef } from "../lib/private-source.js";
import { HOSTED_PRIVATE_PUBLISHING_AVAILABLE } from "../lib/hosted-publishing.js";

/** Largest submission body the proxy buffers. Real bodies are a few hundred bytes. */
export const SUBMISSION_BODY_LIMIT = 64 * 1024;

export type SubmissionRefusalCode = "private_repository" | "unsupported_repository" | "request_too_large" | "missing_tenant" | "private_publishing_unavailable";

export interface SubmissionRefusal {
  status: number;
  error: SubmissionRefusalCode;
  message: string;
}

export type SubmissionScreen = { body: Buffer } | { refusal: SubmissionRefusal };

/** True only for the submission create call: POST on the bare collection path. */
export function isSubmissionCreate(method: string | undefined, url: string | undefined): boolean {
  if ((method ?? "").toUpperCase() !== "POST" || !url) return false;
  const path = url.split("?")[0].replace(/\/+$/, "");
  return path === "/api/v1/submissions";
}

const PUBLIC_ONLY = "verified-skill.com only verifies public repos, so nothing was submitted.";

function unsupported(reason: string): SubmissionRefusal {
  return {
    status: 422,
    error: "unsupported_repository",
    message: `${reason} verified-skill.com only verifies public GitHub repos, so nothing was submitted.`,
  };
}

/** Decide whether a submission for `repoUrl` may be sent. Null means it may. */
export async function checkSubmissionRepo(
  repoUrl: unknown,
  intent: { privacy?: unknown; tenantId?: unknown } = {},
): Promise<SubmissionRefusal | null> {
  if (typeof repoUrl !== "string" || repoUrl.trim() === "") {
    return unsupported("The submission did not name a GitHub repository.");
  }
  const gh = parseGitHubRepoRef(repoUrl);
  if (!gh) return unsupported("The repository is not on GitHub.");
  // A private request is sent only with explicit intent and a selected tenant.
  // The platform authorizes membership, entitlement and installation access;
  // no locally held GitHub credential is attached to this request.
  if (HOSTED_PRIVATE_PUBLISHING_AVAILABLE && intent.privacy === "private") {
    if (typeof intent.tenantId !== "string" || !intent.tenantId.trim()) {
      return {
        status: 400,
        error: "missing_tenant",
        message: "Select a publishing account. If none is available, connect the GitHub App to your account or organization first. Nothing was submitted.",
      };
    }
    return null;
  }
  if (await isPrivateOrUnknownRepo(gh.owner, gh.repo)) {
    return {
      status: 422,
      error: "private_repository",
      message: `${gh.owner}/${gh.repo} is private, or GitHub could not confirm it is public. ${PUBLIC_ONLY}`,
    };
  }
  if (intent.privacy === "private") {
    return {
      status: 503,
      error: "private_publishing_unavailable",
      message: "Hosted private publishing is not available yet. Nothing was submitted.",
    };
  }
  return null;
}

/**
 * Read the request body, keeping at most `limit` bytes. Resolves null when the
 * body is larger; the rest is drained so the client can finish writing.
 */
export function readCappedBody(req: http.IncomingMessage, limit = SUBMISSION_BODY_LIMIT): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(tooLarge ? null : Buffer.concat(chunks)));
    req.on("error", () => resolve(null));
  });
}

/** Buffer and screen a submission create request. */
export async function screenSubmission(req: http.IncomingMessage): Promise<SubmissionScreen> {
  const body = await readCappedBody(req);
  if (!body) {
    return {
      refusal: {
        status: 413,
        error: "request_too_large",
        message: "The submission was too large to check, so nothing was submitted.",
      },
    };
  }
  let repoUrl: unknown;
  let intent: { privacy?: unknown; tenantId?: unknown } = {};
  try {
    const parsed = JSON.parse(body.toString("utf8")) as unknown;
    repoUrl = parsed && typeof parsed === "object" ? (parsed as { repoUrl?: unknown }).repoUrl : undefined;
    if (parsed && typeof parsed === "object") intent = parsed;
  } catch {
    repoUrl = undefined;
  }
  const refusal = await checkSubmissionRepo(repoUrl, intent);
  return refusal ? { refusal } : { body };
}

export function sendSubmissionRefusal(res: http.ServerResponse, refusal: SubmissionRefusal): void {
  if (!res.headersSent) {
    res.writeHead(refusal.status, { "content-type": "application/json", "cache-control": "no-store" });
  }
  if (!res.writableEnded) {
    res.end(JSON.stringify({ error: refusal.error, message: refusal.message }));
  }
}
