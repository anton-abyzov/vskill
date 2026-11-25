// 1486: deprecation notices name the replacement in install, update,
// outdated, info, list and doctor; old installs learn about it from the
// source; nothing is removed or overwritten.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SOURCE_SKILL = `---
name: task-skill-announcer
description: "DEPRECATED: a smoke-test fixture, not a user skill."
metadata:
  version: "1.0.5"
  deprecated: "true"
  deprecated-message: "A smoke-test fixture, not a user skill; moved to e2e fixtures."
  replaced-by: "none"
  deprecated-since: "1.0.5"
---

Moved to e2e fixtures.
`;

// The installed copy predates the field.
const OLD_COPY = `---
name: task-skill-announcer
description: Announces itself.
metadata:
  version: 1.0.3
---

# old body
`;

const rawResponses = new Map<string, string>();
vi.mock("../../lib/github-fetch.js", async (orig) => ({
  ...(await orig<typeof import("../../lib/github-fetch.js")>()),
  githubFetch: vi.fn(async (url: string) => {
    const body = rawResponses.get(url);
    return body === undefined ? new Response("nope", { status: 404 }) : new Response(body, { status: 200 });
  }),
}));
vi.mock("../../lib/private-source.js", async (orig) => ({
  ...(await orig<typeof import("../../lib/private-source.js")>()),
  filterPublicEntries: vi.fn(async (entries: unknown[]) => entries),
  unconfirmedSkipNote: vi.fn(() => null),
  isPrivateSkillName: vi.fn(async () => false),
}));
vi.mock("../../api/client.js", async (orig) => ({
  ...(await orig<typeof import("../../api/client.js")>()),
  checkUpdates: vi.fn(async (items: Array<{ name: string; currentVersion: string }>) =>
    items.map((i) => ({ name: i.name, installed: i.currentVersion, latest: i.currentVersion, updateAvailable: false })),
  ),
}));

const RAW = "https://raw.githubusercontent.com/anton-abyzov/vskill/main/plugins/frontend/skills/task-skill-announcer/SKILL.md";

let root: string;
let prevCwd: string;
let logs: string[];
let errs: string[];

function writeProject(skillMd: string, entryOver: Record<string, unknown> = {}): string {
  const dir = join(root, ".claude", "skills", "task-skill-announcer");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), skillMd);
  writeFileSync(
    join(root, "vskill.lock"),
    JSON.stringify({
      version: 1,
      agents: ["claude-code"],
      createdAt: "",
      updatedAt: "",
      skills: {
        "task-skill-announcer": {
          version: "1.0.3",
          sha: "old",
          tier: "VERIFIED",
          installedAt: "2026-04-26T00:00:00.000Z",
          source: "github:anton-abyzov/vskill",
          sourceSkillPath: "plugins/frontend/skills/task-skill-announcer/SKILL.md",
          sourceBranch: "main",
          scope: "project",
          ...entryOver,
        },
      },
    }),
  );
  return join(dir, "SKILL.md");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vskill-deprecation-"));
  prevCwd = process.cwd();
  process.chdir(root);
  rawResponses.clear();
  logs = [];
  errs = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void errs.push(a.map(String).join(" ")));
});

afterEach(() => {
  vi.restoreAllMocks();
  process.chdir(prevCwd);
  rmSync(root, { recursive: true, force: true });
  process.exitCode = 0;
});

const NOTICE = "task-skill-announcer is deprecated since 1.0.5: A smoke-test fixture, not a user skill; moved to e2e fixtures. Replaced by: none (no replacement).";

describe("vskill outdated (AC-02, AC-03)", () => {
  it("flags an installed copy that predates the field, from the source's current SKILL.md, and changes nothing", async () => {
    const path = writeProject(OLD_COPY, { pinnedVersion: "1.0.3" });
    rawResponses.set(RAW, SOURCE_SKILL);
    const { getOutdatedJson, outdatedCommand } = await import("../outdated.js");

    const data = await getOutdatedJson({ scope: "project", root });
    expect(data?.deprecations).toEqual([
      expect.objectContaining({ name: "task-skill-announcer", skill: "task-skill-announcer", origin: "source" }),
    ]);
    expect(data?.results[0].deprecations).toEqual([
      {
        skill: "task-skill-announcer",
        message: "A smoke-test fixture, not a user skill; moved to e2e fixtures.",
        replacedBy: "none",
        since: "1.0.5",
      },
    ]);

    await outdatedCommand({});
    const printed = logs.join("\n");
    expect(printed).toContain(NOTICE);
    expect(printed.indexOf(NOTICE)).toBeLessThan(printed.indexOf("All skills are up to date."));
    expect(process.exitCode ?? 0).toBe(0);
    expect(readFileSync(path, "utf8")).toBe(OLD_COPY);
  });

  it("keeps --json stdout parseable and sends the notice to stderr", async () => {
    writeProject(OLD_COPY);
    rawResponses.set(RAW, SOURCE_SKILL);
    const { outdatedCommand } = await import("../outdated.js");
    await outdatedCommand({ json: true });
    const parsed = JSON.parse(logs.at(-1)!);
    expect(parsed[0].deprecations[0].replacedBy).toBe("none");
    expect(errs.join("\n")).toContain(NOTICE);
  });
});

describe("vskill list (AC-02)", () => {
  it("marks a deprecated installed skill and prints the notice", async () => {
    writeProject(SOURCE_SKILL);
    const { listCommand } = await import("../list.js");
    await listCommand({});
    const printed = logs.join("\n");
    expect(printed).toContain("(deprecated)");
    expect(printed).toContain(NOTICE);
  });

  it("adds deprecations to --json", async () => {
    writeProject(SOURCE_SKILL);
    const { listCommand } = await import("../list.js");
    await listCommand({ json: true });
    const parsed = JSON.parse(logs.at(-1)!);
    expect(parsed["task-skill-announcer"].deprecations[0].message).toContain("smoke-test fixture");
  });
});

describe("vskill update (AC-02)", () => {
  it("prints the notice from fetched content, and reads the source for skipped entries", async () => {
    const { printUpdateDeprecations } = await import("../update.js");
    const entry = {
      version: "1.0.3", sha: "x", tier: "VERIFIED", installedAt: "",
      source: "github:anton-abyzov/vskill", sourceSkillPath: "plugins/frontend/skills/task-skill-announcer/SKILL.md", sourceBranch: "main",
    };
    await printUpdateDeprecations("task-skill-announcer", entry, SOURCE_SKILL);
    expect(logs.join("\n")).toContain(NOTICE);
    logs.length = 0;
    rawResponses.set(RAW, SOURCE_SKILL);
    await printUpdateDeprecations("task-skill-announcer", entry);
    expect(logs.join("\n")).toContain(NOTICE);
  });
});

describe("vskill install (AC-02)", () => {
  it("prints a notice for each deprecated skill in installed content", async () => {
    const { printDeprecationsIn } = await import("../../lib/deprecation.js");
    printDeprecationsIn(["---\nname: other\n---\n", SOURCE_SKILL].join("\n"), "frontend");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain(NOTICE);
  });
});

describe("vskill info (AC-02)", () => {
  const detail = {
    name: "anton-abyzov/vskill/task-skill-announcer", author: "anton-abyzov", tier: "CERTIFIED", score: 100,
    version: "1.0.5", sha: "", description: "", installs: 0, updatedAt: "",
  };

  it("reads the registry content, then the source, then the platform flag", async () => {
    const { resolveInfoDeprecation } = await import("../info.js");
    expect(await resolveInfoDeprecation({ ...detail, content: SOURCE_SKILL })).toEqual({
      deprecation: { message: "A smoke-test fixture, not a user skill; moved to e2e fixtures.", replacedBy: "none", since: "1.0.5" },
    });

    rawResponses.set(
      "https://raw.githubusercontent.com/anton-abyzov/vskill/HEAD/plugins/frontend/skills/task-skill-announcer/SKILL.md",
      SOURCE_SKILL,
    );
    const fromSource = await resolveInfoDeprecation({
      ...detail,
      repoUrl: "https://github.com/anton-abyzov/vskill",
      skillPath: "plugins/frontend/skills/task-skill-announcer/SKILL.md",
    });
    expect(fromSource && "deprecation" in fromSource && fromSource.deprecation.replacedBy).toBe("none");

    expect(await resolveInfoDeprecation({ ...detail, deprecated: true, deprecationMsg: "Old. Replaced by: none." })).toEqual({
      platformMessage: "Old. Replaced by: none.",
    });
    expect(await resolveInfoDeprecation(detail)).toBeNull();
  });
});

describe("vskill doctor (AC-02, AC-03)", () => {
  it("reports an installed deprecated skill as a warning that --fix leaves alone and the exit code ignores", async () => {
    const path = writeProject(SOURCE_SKILL);
    const { runDoctor, doctorExitCode } = await import("../doctor.js");
    const report = runDoctor({ home: join(root, "home"), cwd: root, fix: true });
    const deprecated = report.issues.filter((i) => i.kind === "deprecated");
    expect(deprecated).toHaveLength(1);
    expect(deprecated[0]).toMatchObject({ severity: "warning", fixable: false, skill: "task-skill-announcer" });
    expect(deprecated[0].message).toContain("Replaced by: none (no replacement).");
    expect(report.fixes).toEqual([]);
    expect(doctorExitCode(report)).toBe(0);
    expect(readFileSync(path, "utf8")).toBe(SOURCE_SKILL);
  });

  it("flags an old install from the source's current metadata", async () => {
    writeProject(OLD_COPY);
    const { runDoctorWithSources, doctorCommand } = await import("../doctor.js");
    const report = await runDoctorWithSources({
      home: join(root, "home"),
      cwd: root,
      fetchText: async (url) => (url === RAW ? SOURCE_SKILL : null),
    });
    const deprecated = report.issues.filter((i) => i.kind === "deprecated");
    expect(deprecated).toHaveLength(1);
    expect(deprecated[0].message).toContain("installed copy predates it");
    expect(report.summary.deprecated).toBe(1);

    rawResponses.set(RAW, SOURCE_SKILL);
    await doctorCommand({ home: join(root, "home"), cwd: root });
    expect(logs.join("\n")).toContain("deprecated (1)");
    expect(process.exitCode).toBe(0);
  });
});
