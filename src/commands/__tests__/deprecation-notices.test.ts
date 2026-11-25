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
vi.mock("../../agents/agents-registry.js", async (orig) => ({
  ...(await orig<typeof import("../../agents/agents-registry.js")>()),
  detectInstalledAgents: vi.fn(async () => [
    { id: "claude-code", displayName: "Claude Code", localSkillsDir: ".claude/skills", globalSkillsDir: "~/.claude/skills" },
  ]),
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
  // D-06: upstream reads are plain unauthenticated GETs on raw URLs.
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const body = rawResponses.get(String(url));
    return body === undefined ? new Response("nope", { status: 404 }) : new Response(body, { status: 200 });
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
    // The source changed since install, so --json also reports an update (exit 1).
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    await outdatedCommand({ json: true });
    expect(exit).toHaveBeenCalledWith(1);
    // stdout is exactly one JSON payload; the notice went to stderr.
    const parsed = JSON.parse(logs.join("\n"));
    expect(parsed[0]).toMatchObject({ updateAvailable: true, sourceChanged: true });
    expect(parsed[0].deprecations[0].replacedBy).toBe("none");
    expect(errs.join("\n")).toContain(NOTICE);
  });
});

describe("vskill outdated with an installer-shaped pinned lock (AC-03)", () => {
  it("reads the default branch, not the pinned commit stored as sourceBranch", async () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    writeProject(OLD_COPY, { pinnedVersion: "1.0.3", sourceBranch: sha, sourceCommitSha: sha });
    rawResponses.set(RAW.replace("/main/", `/${sha}/`), OLD_COPY);
    rawResponses.set(RAW.replace("/main/", "/HEAD/"), SOURCE_SKILL);
    const { getOutdatedJson } = await import("../outdated.js");
    const data = await getOutdatedJson({ scope: "project", root });
    expect(data?.deprecations.map((d) => d.origin)).toEqual(["source"]);
  });

  it("flags an old flat-layout plugin install from the plugin-root SKILL.md", async () => {
    mkdirSync(join(root, ".claude", "skills", "solo"), { recursive: true });
    writeFileSync(join(root, ".claude", "skills", "solo", "SKILL.md"), OLD_COPY.replace("task-skill-announcer", "solo"));
    writeFileSync(join(root, "vskill.lock"), JSON.stringify({
      version: 1, agents: ["claude-code"], createdAt: "", updatedAt: "",
      skills: { solo: { version: "1.0.0", sha: "", tier: "VERIFIED", installedAt: "", source: "github:o/r#plugin:solo", scope: "project", files: ["SKILL.md"] } },
    }));
    rawResponses.set("https://raw.githubusercontent.com/o/r/HEAD/.claude-plugin/marketplace.json", JSON.stringify({ plugins: [{ name: "solo", source: "./plugins/solo" }] }));
    rawResponses.set("https://raw.githubusercontent.com/o/r/HEAD/plugins/solo/SKILL.md", SOURCE_SKILL.replace("name: task-skill-announcer", "name: solo"));
    const { getOutdatedJson } = await import("../outdated.js");
    const data = await getOutdatedJson({ scope: "project", root });
    expect(data?.deprecations).toEqual([expect.objectContaining({ name: "solo", skill: "solo", origin: "source" })]);
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

  it("finds skills where the plugin and marketplace installers put them", async () => {
    // --repo --plugin: <base>/<plugin>/<skill>/ with a nested file record, in the shared folder.
    const nested = join(root, ".agents", "skills", "frontend", "task-skill-announcer");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "SKILL.md"), SOURCE_SKILL);
    // Marketplace: <base>/<skill>/ with a skills record.
    const flat = join(root, ".claude", "skills", "gws");
    mkdirSync(flat, { recursive: true });
    writeFileSync(join(flat, "SKILL.md"), SOURCE_SKILL.replace("name: task-skill-announcer", "name: gws"));
    writeFileSync(join(root, "vskill.lock"), JSON.stringify({
      version: 1, agents: ["claude-code"], createdAt: "", updatedAt: "",
      skills: {
        frontend: { version: "0.2.1", sha: "", tier: "VERIFIED", installedAt: "", source: "github:anton-abyzov/vskill#plugin:frontend", scope: "project", files: ["task-skill-announcer/SKILL.md"] },
        "google-workspace": { version: "0.1.1", sha: "", tier: "VERIFIED", installedAt: "", source: "marketplace:anton-abyzov/vskill#google-workspace", pluginDir: true, skills: ["gws"], scope: "project" },
      },
    }));
    const { listCommand } = await import("../list.js");
    await listCommand({});
    const printed = logs.join("\n");
    expect(printed).toContain(NOTICE);
    expect(printed).toContain("gws is deprecated since 1.0.5");
  });

  it("adds deprecations to --json", async () => {
    writeProject(SOURCE_SKILL);
    const { listCommand } = await import("../list.js");
    await listCommand({ json: true });
    const parsed = JSON.parse(logs.join("\n"));
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

describe("vskill update command path (AC-02)", () => {
  it("names the replacement for a pinned registry skill from its installed copy, and changes nothing", async () => {
    const path = writeProject(SOURCE_SKILL, { source: "registry:task-skill-announcer", sourceSkillPath: undefined, sourceBranch: undefined, pinnedVersion: "1.0.5" });
    const { updateCommand } = await import("../update.js");
    await updateCommand(undefined, {});
    expect(logs.join("\n")).toContain(NOTICE);
    expect(readFileSync(path, "utf8")).toBe(SOURCE_SKILL);
  });
});

describe("vskill install (AC-02)", () => {
  it("prints the notice from an installed SKILL.md's own frontmatter, not from examples in other files", async () => {
    const { printDeprecationsIn, printPluginDirDeprecations } = await import("../../lib/deprecation.js");
    printDeprecationsIn("---\nname: other\n---\n", "other");
    expect(logs).toHaveLength(0);
    printDeprecationsIn(SOURCE_SKILL, "frontend");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain(NOTICE);
    // A local plugin folder: each skills/<dir>/SKILL.md on its own.
    logs.length = 0;
    const plug = join(root, "plug");
    mkdirSync(join(plug, "skills", "task-skill-announcer"), { recursive: true });
    mkdirSync(join(plug, "skills", "active"), { recursive: true });
    writeFileSync(join(plug, "skills", "task-skill-announcer", "SKILL.md"), SOURCE_SKILL);
    writeFileSync(join(plug, "skills", "active", "SKILL.md"), "---\nname: active\n---\n```yaml\n---\nmetadata:\n  deprecated: \"true\"\n---\n```\n");
    printPluginDirDeprecations(plug, "plug");
    expect(logs).toEqual([expect.stringContaining(NOTICE)]);
  });
});

describe("vskill list attribution (AC-02)", () => {
  it("never attributes an unrelated flat copy to a --plugin install", async () => {
    // The plugin's own copy (<base>/tools/example/) is gone; an independent
    // deprecated .claude/skills/example/ exists.
    const flat = join(root, ".claude", "skills", "example");
    mkdirSync(flat, { recursive: true });
    writeFileSync(join(flat, "SKILL.md"), SOURCE_SKILL.replace("name: task-skill-announcer", "name: example"));
    writeFileSync(join(root, "vskill.lock"), JSON.stringify({
      version: 1, agents: ["claude-code"], createdAt: "", updatedAt: "",
      skills: { tools: { version: "1.0.0", sha: "", tier: "VERIFIED", installedAt: "", source: "github:o/r#plugin:tools", scope: "project", files: ["example/SKILL.md"] } },
    }));
    const { listCommand } = await import("../list.js");
    await listCommand({ json: true });
    const parsed = JSON.parse(logs.join("\n"));
    expect(parsed.tools.deprecations ?? []).toEqual([]);
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
