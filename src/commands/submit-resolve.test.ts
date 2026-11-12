import { describe, it, expect, vi, beforeEach } from "vitest";

// Skill naming, cwd-checkout resolution, push checks and --wait/--submission
// for the public `vskill submit` path.

const mockRepoStatus = vi.hoisted(() => ({ value: "public" as "public" | "private" | "not-found" | "unconfirmed" }));
vi.mock("../lib/private-source.js", () => ({
  isTypedRepoPrivate: vi.fn(async () => false),
  typedRepoStatus: vi.fn(async () => mockRepoStatus.value),
}));

vi.mock("../utils/browser.js", () => ({ openBrowser: vi.fn() }));

const mockSubmitSkill = vi.fn();
const mockGetSubmission = vi.fn();
vi.mock("../api/client.js", () => ({
  submitSkill: (...a: unknown[]) => mockSubmitSkill(...a),
  getSubmission: (...a: unknown[]) => mockGetSubmission(...a),
  getVersions: vi.fn(async () => []),
}));

interface FakeCheckout {
  root: string;
  owner: string | null;
  repo: string | null;
  remoteUrl: string | null;
  branch: string | null;
  pushed: boolean;
  hasUpstream: boolean;
  defaultBranch: string | null;
}
const git = vi.hoisted(() => ({
  checkout: null as FakeCheckout | null,
  localFile: null as string | null,
  skillName: null as string | null,
  tracked: [] as string[],
  committed: true,
  onOrigin: [] as string[],
}));
vi.mock("../lib/git-checkout.js", () => ({
  readLocalCheckout: () => git.checkout,
  locateSkillFile: () => git.localFile,
  readSkillName: () => git.skillName,
  listTrackedSkillFiles: () => git.tracked,
  isCommitted: () => git.committed,
  isOnOriginBranch: (_c: FakeCheckout, branch: string, file: string) => git.onOrigin.includes(`${branch}:${file}`),
  toRepoPath: (c: FakeCheckout, abs: string) =>
    abs.startsWith(c.root + "/") ? abs.slice(c.root.length + 1) : null,
}));

vi.mock("../utils/output.js", () => ({
  bold: (s: string) => s,
  green: (s: string) => s,
  red: (s: string) => s,
  yellow: (s: string) => s,
  dim: (s: string) => s,
  cyan: (s: string) => s,
}));

const { submitCommand } = await import("./submit.js");

const pushedCheckout = (): FakeCheckout => ({
  root: "/work/greet",
  owner: "myorg",
  repo: "greet-skill",
  remoteUrl: "git@github.com:myorg/greet-skill.git",
  branch: "main",
  pushed: true,
  hasUpstream: true,
  defaultBranch: "main",
});

let log: ReturnType<typeof vi.spyOn>;
let err: ReturnType<typeof vi.spyOn>;
let exit: ReturnType<typeof vi.spyOn>;
const out = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c) => c.join(" ")).join("\n");

beforeEach(() => {
  vi.clearAllMocks();
  mockRepoStatus.value = "public";
  git.checkout = null;
  git.localFile = null;
  git.skillName = null;
  git.tracked = [];
  git.committed = true;
  git.onOrigin = [];
  mockSubmitSkill.mockResolvedValue({ id: "sub_new", state: "RECEIVED" });
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  err = vi.spyOn(console, "error").mockImplementation(() => {});
  exit = vi.spyOn(process, "exit").mockImplementation((code?: number) => {
    throw new Error(`exit:${code}`);
  });
});

describe("vskill submit owner/repo without --skill", () => {
  it("sends the repo name as skillName when no local SKILL.md belongs to that repo", async () => {
    await submitCommand("myorg/myrepo", {});
    expect(mockSubmitSkill).toHaveBeenCalledWith(
      expect.objectContaining({ repoUrl: "https://github.com/myorg/myrepo", skillName: "myrepo" }),
    );
  });

  it("sends the local SKILL.md name and its repo path when the cwd checkout is that repo", async () => {
    git.checkout = pushedCheckout();
    git.localFile = "/work/greet/skills/greet/SKILL.md";
    git.skillName = "greet";
    await submitCommand("myorg/greet-skill", {});
    expect(mockSubmitSkill).toHaveBeenCalledWith({
      repoUrl: "https://github.com/myorg/greet-skill",
      skillName: "greet",
      skillPath: "skills/greet/SKILL.md",
      source: "cli-submit",
    });
  });

  it("ignores a local SKILL.md from a different repo", async () => {
    git.checkout = { ...pushedCheckout(), owner: "someone", repo: "else" };
    git.localFile = "/work/greet/SKILL.md";
    git.skillName = "local-name";
    await submitCommand("myorg/greet-skill", {});
    expect(mockSubmitSkill).toHaveBeenCalledWith(expect.objectContaining({ skillName: "greet-skill" }));
  });
});

describe("vskill submit with no argument", () => {
  it("resolves owner/repo from origin and the skill from the SKILL.md in the cwd", async () => {
    git.checkout = pushedCheckout();
    git.localFile = "/work/greet/SKILL.md";
    git.skillName = "greet";
    await submitCommand(undefined, {});
    expect(mockSubmitSkill).toHaveBeenCalledWith({
      repoUrl: "https://github.com/myorg/greet-skill",
      skillName: "greet",
      skillPath: "SKILL.md",
      source: "cli-submit",
    });
  });

  it("uses the only tracked SKILL.md when the cwd has none", async () => {
    git.checkout = pushedCheckout();
    git.tracked = ["skills/greet/SKILL.md"];
    git.skillName = "greet";
    await submitCommand(undefined, {});
    expect(mockSubmitSkill).toHaveBeenCalledWith(expect.objectContaining({ skillPath: "skills/greet/SKILL.md" }));
  });

  it("asks for --path when the repo has several skills", async () => {
    git.checkout = pushedCheckout();
    git.tracked = ["a/SKILL.md", "b/SKILL.md"];
    await expect(submitCommand(undefined, {})).rejects.toThrow("exit:1");
    expect(out(err)).toContain("vskill submit --path a/SKILL.md");
    expect(mockSubmitSkill).not.toHaveBeenCalled();
  });

  it("fails clearly outside a git checkout", async () => {
    await expect(submitCommand(undefined, {})).rejects.toThrow("exit:1");
    expect(out(err)).toContain("Not inside a git checkout.");
    expect(mockSubmitSkill).not.toHaveBeenCalled();
  });

  it("prints the gh repo create commands when there is no origin remote", async () => {
    git.checkout = { ...pushedCheckout(), owner: null, repo: null, remoteUrl: null, hasUpstream: false, pushed: false };
    await expect(submitCommand(undefined, {})).rejects.toThrow("exit:1");
    expect(out(err)).toContain("gh repo create <owner>/<repo> --public --source=. --remote=origin --push");
    expect(mockSubmitSkill).not.toHaveBeenCalled();
  });

  it("refuses a non-GitHub origin", async () => {
    git.checkout = { ...pushedCheckout(), owner: null, repo: null, remoteUrl: "https://gitlab.com/o/r.git" };
    await expect(submitCommand(undefined, {})).rejects.toThrow("exit:1");
    expect(out(err)).toContain("origin is not a GitHub repository");
  });

  it("tells the user to push a branch that has no upstream", async () => {
    git.checkout = { ...pushedCheckout(), hasUpstream: false, pushed: false };
    git.localFile = "/work/greet/SKILL.md";
    git.skillName = "greet";
    await expect(submitCommand(undefined, {})).rejects.toThrow("exit:1");
    expect(out(err)).toContain("Branch main is not on GitHub yet");
    expect(out(err)).toContain("git push -u origin HEAD");
    expect(mockSubmitSkill).not.toHaveBeenCalled();
  });

  it("tells the user to push unpushed commits", async () => {
    git.checkout = { ...pushedCheckout(), pushed: false };
    git.localFile = "/work/greet/SKILL.md";
    git.skillName = "greet";
    await expect(submitCommand(undefined, {})).rejects.toThrow("exit:1");
    expect(out(err)).toContain("has commits that are not on GitHub yet");
    expect(mockSubmitSkill).not.toHaveBeenCalled();
  });

  it("refuses an uncommitted SKILL.md", async () => {
    git.checkout = pushedCheckout();
    git.localFile = "/work/greet/SKILL.md";
    git.committed = false;
    await expect(submitCommand(undefined, {})).rejects.toThrow("exit:1");
    expect(out(err)).toContain("SKILL.md is not committed yet");
  });

  it("refuses a pushed feature branch whose SKILL.md is not on the default branch", async () => {
    git.checkout = { ...pushedCheckout(), branch: "add-greet" };
    git.localFile = "/work/greet/skills/greet/SKILL.md";
    git.skillName = "greet";
    await expect(submitCommand(undefined, {})).rejects.toThrow("exit:1");
    const text = out(err);
    expect(text).toContain("skills/greet/SKILL.md is on add-greet but not on main");
    expect(text).toContain("gh pr create --fill --base main");
    expect(text).toContain("git checkout main && git merge add-greet && git push");
    expect(text).toContain("git fetch origin");
    expect(mockSubmitSkill).not.toHaveBeenCalled();
  });

  it("submits from a feature branch when the SKILL.md is already on the default branch", async () => {
    git.checkout = { ...pushedCheckout(), branch: "tweak" };
    git.localFile = "/work/greet/skills/greet/SKILL.md";
    git.skillName = "greet";
    git.onOrigin = ["main:skills/greet/SKILL.md"];
    await submitCommand(undefined, {});
    expect(mockSubmitSkill).toHaveBeenCalledWith(expect.objectContaining({ skillPath: "skills/greet/SKILL.md" }));
  });

  it("warns, but submits, from a non-main branch when the default branch is unknown", async () => {
    git.checkout = { ...pushedCheckout(), branch: "develop", defaultBranch: null };
    git.localFile = "/work/greet/SKILL.md";
    git.skillName = "greet";
    await submitCommand(undefined, {});
    expect(out(log)).toContain("You are on develop");
    expect(mockSubmitSkill).toHaveBeenCalled();
  });

  it("prints create-and-push commands when origin points at a repo GitHub does not have", async () => {
    git.checkout = { ...pushedCheckout(), hasUpstream: false, pushed: false };
    git.localFile = "/work/greet/SKILL.md";
    git.skillName = "greet";
    mockRepoStatus.value = "not-found";
    await expect(submitCommand(undefined, {})).rejects.toThrow("exit:1");
    expect(out(err)).toContain("gh repo create myorg/greet-skill --public");
    expect(out(err)).toContain("git push -u origin HEAD");
  });
});

describe("following a submission", () => {
  const detail = (state: string, extra: Record<string, unknown> = {}) => ({
    id: "sub_new",
    repoUrl: "https://github.com/myorg/myrepo",
    skillName: "myrepo",
    state,
    createdAt: "x",
    updatedAt: "x",
    ...extra,
  });

  it("--wait polls until published and prints each state once", async () => {
    vi.useFakeTimers();
    try {
      mockGetSubmission
        .mockResolvedValueOnce(detail("RECEIVED"))
        .mockResolvedValueOnce(detail("TIER1_SCANNING"))
        .mockResolvedValueOnce(detail("TIER1_SCANNING"))
        .mockResolvedValueOnce(detail("PUBLISHED", { publishedSkillName: "myorg/myrepo/myrepo" }));
      const run = submitCommand("myorg/myrepo", { wait: true });
      await vi.runAllTimersAsync();
      await run;
      expect(mockGetSubmission).toHaveBeenCalledTimes(4);
      const text = out(log);
      expect(text.match(/TIER1_SCANNING/g)).toHaveLength(1);
      expect(text).toContain("Published as myorg/myrepo/myrepo");
      expect(exit).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("--wait exits 1 on REJECTED and prints the findings", async () => {
    mockGetSubmission.mockResolvedValueOnce(
      detail("REJECTED", {
        scanResult: {
          tier: 1,
          verdict: "FAIL",
          score: 20,
          findings: [{ patternName: "Remote code download", severity: "critical", file: "SKILL.md", lineNumber: 12 }],
        },
      }),
    );
    await expect(submitCommand("myorg/myrepo", { wait: true })).rejects.toThrow("exit:1");
    const text = out(err);
    expect(text).toContain("Not published: REJECTED");
    expect(text).toContain("CRITICAL Remote code download (SKILL.md:12)");
  });

  it("--wait stops at the ceiling and prints how to check again", async () => {
    vi.useFakeTimers();
    try {
      mockGetSubmission.mockResolvedValue(detail("TIER2_SCANNING"));
      const run = submitCommand("myorg/myrepo", { wait: true });
      await vi.runAllTimersAsync();
      await run;
      // 5 min ceiling at a 3 s interval: about 100 polls, never unbounded.
      expect(mockGetSubmission.mock.calls.length).toBeGreaterThan(90);
      expect(mockGetSubmission.mock.calls.length).toBeLessThanOrEqual(101);
      expect(out(log)).toContain("vskill submit --submission sub_new --wait");
      expect(exit).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("without --wait prints how to follow the submission and does not poll", async () => {
    await submitCommand("myorg/myrepo", {});
    expect(mockGetSubmission).not.toHaveBeenCalled();
    expect(out(log)).toContain("vskill submit --submission sub_new --wait");
  });

  it("--submission <id> prints the current state without submitting", async () => {
    mockGetSubmission.mockResolvedValueOnce(detail("TIER1_SCANNING"));
    await submitCommand(undefined, { submission: "sub_old" });
    expect(mockSubmitSkill).not.toHaveBeenCalled();
    expect(mockGetSubmission).toHaveBeenCalledWith("sub_old");
    expect(out(log)).toContain("Submission sub_old: TIER1_SCANNING");
  });

  it("--submission <id> exits 1 for a rejected submission", async () => {
    mockGetSubmission.mockResolvedValueOnce(detail("BLOCKED", { blockInfo: { reason: "Known malware", findings: [] } }));
    await expect(submitCommand(undefined, { submission: "sub_old" })).rejects.toThrow("exit:1");
    expect(out(err)).toContain("Reason: Known malware");
  });

  it("--submission <id> reports an unknown id", async () => {
    mockGetSubmission.mockRejectedValueOnce(Object.assign(new Error("API request failed: 404 Not Found"), { status: 404 }));
    await expect(submitCommand(undefined, { submission: "sub_missing" })).rejects.toThrow("exit:1");
    expect(out(err)).toContain("Submission sub_missing was not found");
  });

  it("--wait keeps polling through a transient 503", async () => {
    vi.useFakeTimers();
    try {
      mockGetSubmission
        .mockResolvedValueOnce(detail("RECEIVED"))
        .mockRejectedValueOnce(Object.assign(new Error("API request failed: 503"), { status: 503 }))
        .mockResolvedValueOnce(detail("PUBLISHED"));
      const run = submitCommand("myorg/myrepo", { wait: true });
      await vi.runAllTimersAsync();
      await run;
      expect(mockGetSubmission).toHaveBeenCalledTimes(3);
      expect(exit).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("--wait stops at once on a permanent 4xx instead of polling to the ceiling", async () => {
    mockGetSubmission.mockRejectedValue(Object.assign(new Error("API request failed: 400 Bad Request"), { status: 400 }));
    await expect(submitCommand(undefined, { submission: "bad id", wait: true })).rejects.toThrow("exit:1");
    expect(mockGetSubmission).toHaveBeenCalledTimes(1);
    expect(out(err)).toContain("Could not read the submission");
  });

  it("--wait keeps polling through a 429", async () => {
    vi.useFakeTimers();
    try {
      mockGetSubmission
        .mockRejectedValueOnce(Object.assign(new Error("API request failed: 429"), { status: 429 }))
        .mockResolvedValueOnce(detail("PUBLISHED"));
      const run = submitCommand(undefined, { submission: "sub_old", wait: true });
      await vi.runAllTimersAsync();
      await run;
      expect(mockGetSubmission).toHaveBeenCalledTimes(2);
      expect(exit).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a private psub_ id without --private is still a usage error", async () => {
    await expect(submitCommand(undefined, { submission: "psub_1" })).rejects.toThrow("exit:1");
    expect(mockGetSubmission).not.toHaveBeenCalled();
  });
});
