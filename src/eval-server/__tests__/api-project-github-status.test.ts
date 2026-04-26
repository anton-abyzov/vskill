// ---------------------------------------------------------------------------
// 0772 US-005 — detectProjectGitHubStatus three-state contract.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectProjectGitHubStatus } from "../skill-create-routes.js";

let root: string;

function gitInit(dir: string): void {
  spawnSync("git", ["init", "-q"], { cwd: dir });
  // Make commits possible without touching global config.
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: dir });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vskill-gh-status-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("detectProjectGitHubStatus (0772 US-005 AC-US5-01)", () => {
  it("returns status='no-git' when there is no .git dir", () => {
    const result = detectProjectGitHubStatus(root);
    expect(result).toEqual({
      hasGit: false,
      githubOrigin: null,
      status: "no-git",
    });
  });

  it("returns status='non-github' when origin is missing", () => {
    gitInit(root);
    const result = detectProjectGitHubStatus(root);
    expect(result.hasGit).toBe(true);
    expect(result.githubOrigin).toBeNull();
    expect(result.status).toBe("non-github");
  });

  it("returns status='github' when origin is a github.com URL (https)", () => {
    gitInit(root);
    spawnSync("git", ["remote", "add", "origin", "https://github.com/foo/bar.git"], { cwd: root });
    const result = detectProjectGitHubStatus(root);
    expect(result.hasGit).toBe(true);
    expect(result.githubOrigin).toBe("https://github.com/foo/bar");
    expect(result.status).toBe("github");
  });

  it("returns status='github' when origin is a github.com URL (ssh)", () => {
    gitInit(root);
    spawnSync("git", ["remote", "add", "origin", "git@github.com:foo/bar.git"], { cwd: root });
    const result = detectProjectGitHubStatus(root);
    expect(result.status).toBe("github");
    expect(result.githubOrigin).toBe("https://github.com/foo/bar");
  });

  it("returns status='non-github' when origin points elsewhere (gitlab)", () => {
    gitInit(root);
    spawnSync("git", ["remote", "add", "origin", "https://gitlab.com/foo/bar.git"], { cwd: root });
    const result = detectProjectGitHubStatus(root);
    expect(result.status).toBe("non-github");
    expect(result.githubOrigin).toBeNull();
  });

  it("walks up from a nested subdirectory to find the .git root", () => {
    gitInit(root);
    spawnSync("git", ["remote", "add", "origin", "https://github.com/foo/bar.git"], { cwd: root });
    const nested = join(root, "a", "b", "c");
    mkdirSync(nested, { recursive: true });
    const result = detectProjectGitHubStatus(nested);
    expect(result.status).toBe("github");
  });
});
