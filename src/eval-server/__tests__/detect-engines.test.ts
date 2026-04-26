// ---------------------------------------------------------------------------
// Tests for GET /api/studio/detect-engines route.
// Ref: .specweave/increments/0734-studio-create-skill-engine-selector
// ACs: AC-US1-01, AC-US1-02, AC-US1-05, AC-US1-06
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as http from "node:http";

const detectionMock = vi.hoisted(() => ({
  skillCreator: false,
  skillBuilder: { installed: false, path: null as string | null, version: null as string | null },
  skillCreatorPath: null as string | null,
}));

vi.mock("../../utils/skill-creator-detection.js", () => ({
  isSkillCreatorInstalled: () => detectionMock.skillCreator,
  findSkillCreatorPath: () => detectionMock.skillCreatorPath,
}));

vi.mock("../../utils/skill-builder-detection.js", () => ({
  isSkillBuilderInstalled: () => detectionMock.skillBuilder,
}));

const { Router } = await import("../router.js");
const { registerDetectEnginesRoute } = await import("../detect-engines-route.js");

beforeEach(() => {
  detectionMock.skillCreator = false;
  detectionMock.skillBuilder = { installed: false, path: null, version: null };
  detectionMock.skillCreatorPath = null;
});

interface JsonResponse {
  status: number;
  body: unknown;
}

async function callRoute(): Promise<JsonResponse> {
  const router = new Router();
  registerDetectEnginesRoute(router, "/fake/root");

  const req = {
    method: "GET",
    url: "/api/studio/detect-engines",
    headers: { host: "127.0.0.1:3077" },
  } as unknown as http.IncomingMessage;

  let status = 0;
  let body: unknown = null;
  const res = {
    statusCode: 200,
    setHeader: () => {},
    writeHead(s: number) { status = s; },
    write(chunk: string) { body = JSON.parse(chunk); },
    end(chunk?: string) {
      if (chunk) {
        try { body = JSON.parse(chunk); } catch { body = chunk; }
      }
      if (status === 0) status = this.statusCode;
    },
  } as unknown as http.ServerResponse & { statusCode: number };

  await router.handle(req, res);
  return { status, body };
}

describe("AC-US1-01: response shape", () => {
  it("returns 200 with all four fields when both engines installed", async () => {
    detectionMock.skillCreator = true;
    detectionMock.skillCreatorPath = "/home/u/.claude/skills/skill-creator";
    detectionMock.skillBuilder = {
      installed: true,
      path: "/proj/plugins/skills/skills/skill-builder/SKILL.md",
      version: "0.1.0",
    };

    const { status, body } = await callRoute();
    expect(status).toBe(200);
    expect(body).toEqual({
      vskillSkillBuilder: true,
      anthropicSkillCreator: true,
      vskillVersion: "0.1.0",
      anthropicPath: "/home/u/.claude/skills/skill-creator",
    });
  });
});

describe("AC-US1-02: anthropicPath uses findSkillCreatorPath", () => {
  it("returns the matched path when skill-creator is installed", async () => {
    detectionMock.skillCreator = true;
    detectionMock.skillCreatorPath = "/usr/local/share/skill-creator";

    const { body } = await callRoute();
    expect((body as { anthropicPath: string }).anthropicPath).toBe("/usr/local/share/skill-creator");
  });

  it("returns null path when skill-creator is not installed", async () => {
    detectionMock.skillCreator = false;
    detectionMock.skillCreatorPath = null;

    const { body } = await callRoute();
    expect((body as { anthropicPath: string | null }).anthropicPath).toBe(null);
  });
});

describe("AC-US1-06: all four detection combinations", () => {
  it("only vskill installed", async () => {
    detectionMock.skillBuilder = {
      installed: true,
      path: "/proj/plugins/skills/skills/skill-builder/SKILL.md",
      version: "0.1.0",
    };
    const { body } = await callRoute();
    expect(body).toEqual({
      vskillSkillBuilder: true,
      anthropicSkillCreator: false,
      vskillVersion: "0.1.0",
      anthropicPath: null,
    });
  });

  it("only anthropic installed", async () => {
    detectionMock.skillCreator = true;
    detectionMock.skillCreatorPath = "/some/path";
    const { body } = await callRoute();
    expect(body).toEqual({
      vskillSkillBuilder: false,
      anthropicSkillCreator: true,
      vskillVersion: null,
      anthropicPath: "/some/path",
    });
  });

  it("neither installed", async () => {
    const { body } = await callRoute();
    expect(body).toEqual({
      vskillSkillBuilder: false,
      anthropicSkillCreator: false,
      vskillVersion: null,
      anthropicPath: null,
    });
  });

  it("vskill installed without version (frontmatter missing)", async () => {
    detectionMock.skillBuilder = {
      installed: true,
      path: "/some/dir",
      version: null,
    };
    const { body } = await callRoute();
    expect((body as { vskillSkillBuilder: boolean; vskillVersion: string | null }).vskillSkillBuilder).toBe(true);
    expect((body as { vskillVersion: string | null }).vskillVersion).toBe(null);
  });
});
