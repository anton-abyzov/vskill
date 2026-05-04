// ---------------------------------------------------------------------------
// vskill clone — github-scaffold
// ---------------------------------------------------------------------------
// Optional `gh repo create` + initial commit/push for a freshly-scaffolded
// new-plugin directory. The `runGh` adapter is injectable so unit tests can
// substitute a recording fake; the default adapter shells out to the local
// `gh` binary via node:child_process.
//
// Failure modes:
//   - `gh` not installed (ENOENT) → resolve with { skipped: true, reason }
//   - `gh repo create` rejects (non-zero exit) → resolve with { skipped: true, reason }
//
// In both cases the on-disk plugin remains intact — the orchestrator surfaces
// the warning but reports the overall clone as a success (AC-US3-02).
//
// Sequencing: this function is called ONLY after the plugin's `.tmp` has been
// atomically renamed into place (AC-US3-03), so a partial-state failure here
// can never corrupt the destination plugin.
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";

export interface RunGhResult {
  stdout: string;
  stderr: string;
  code: number;
}

export type RunGh = (args: string[], opts?: { cwd?: string }) => Promise<RunGhResult>;

export interface ScaffoldGitHubArgs {
  /** Local path to the directory that will become the GitHub repo root. */
  pluginDir: string;
  /** Repo name (without owner). The owner is whatever `gh` is currently authenticated as. */
  repoName: string;
  /** Optional repo description (passed to `gh repo create -d`). */
  description?: string;
  /** Whether the new repo should be public. Defaults to true. */
  public?: boolean;
  /** Injectable `gh` adapter — defaults to spawning the local `gh` binary. */
  runGh?: RunGh;
}

export interface ScaffoldGitHubResult {
  skipped: boolean;
  /** When skipped, a short human-readable reason. */
  reason?: string;
  /** Repo URL when the create step succeeded. */
  repoUrl?: string;
  /** Argv recorded for each `gh` invocation — useful for debugging and tests. */
  invocations: string[][];
}

/**
 * Default `runGh` adapter — spawn the local `gh` binary.
 *
 * Surfacing semantics: never throws on a non-zero exit. ENOENT (binary not on
 * PATH) is forwarded as a thrown error so the caller can convert it to a
 * graceful skip with a clear "gh not installed" message.
 */
function defaultRunGh(args: string[], opts: { cwd?: string } = {}): Promise<RunGhResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      reject(err);
    });
    child.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
}

function isENOENT(err: unknown): boolean {
  return Boolean(err) && (err as NodeJS.ErrnoException).code === "ENOENT";
}

/**
 * Run `gh repo create <name> --public/--private --source <pluginDir> --push`.
 *
 * The `--source <dir> --push` form initializes a git repo if needed and pushes
 * the initial commit in one step. When `gh` is missing or the create step
 * fails, the function resolves with `skipped: true` and a clear reason —
 * never throws.
 */
export async function scaffoldGitHub(args: ScaffoldGitHubArgs): Promise<ScaffoldGitHubResult> {
  const runGh: RunGh = args.runGh ?? defaultRunGh;
  const isPublic = args.public !== false;
  const visibilityFlag = isPublic ? "--public" : "--private";
  const invocations: string[][] = [];

  const createArgv = ["repo", "create", args.repoName, visibilityFlag];
  if (args.description) {
    createArgv.push("--description", args.description);
  }
  // --source + --push will initialize a git repo (if absent), commit, and push.
  createArgv.push("--source", args.pluginDir, "--push");

  let createResult: RunGhResult;
  try {
    invocations.push([...createArgv]);
    createResult = await runGh(createArgv, { cwd: args.pluginDir });
  } catch (err) {
    if (isENOENT(err)) {
      return {
        skipped: true,
        reason: "gh CLI not installed (binary not found on PATH)",
        invocations,
      };
    }
    return {
      skipped: true,
      reason: `gh invocation failed: ${(err as Error).message}`,
      invocations,
    };
  }

  if (createResult.code !== 0) {
    return {
      skipped: true,
      reason: `gh repo create exited ${createResult.code}: ${createResult.stderr.trim() || createResult.stdout.trim()}`,
      invocations,
    };
  }

  // `gh repo create --source --push` prints the repo URL to stdout. The exact
  // line varies but always contains a `https://github.com/<owner>/<name>`
  // segment — extract the first such occurrence as the repoUrl.
  const urlMatch = createResult.stdout.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+/);
  return {
    skipped: false,
    repoUrl: urlMatch ? urlMatch[0] : undefined,
    invocations,
  };
}
