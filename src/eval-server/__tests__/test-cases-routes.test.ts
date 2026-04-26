// Integration tests for GET + PUT /api/skills/:plugin/:skill/test-cases
// Uses real filesystem under a tmp dir to avoid the heavy mock-everything pattern.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Router } from "../router.js";
import { registerRoutes } from "../api-routes.js";
import { parseTestCases } from "../../eval/test-case-parser.js";

// Minimal fake req/res — just enough to satisfy the route handlers.
function makeReq(method: string, url: string, body?: unknown): any {
  const req: any = {
    method,
    url,
    headers: { host: "localhost:3079", "content-type": "application/json" },
  };
  // EventEmitter-ish for readBody
  const handlers: Record<string, Function[]> = {};
  req.on = (event: string, cb: Function) => {
    (handlers[event] = handlers[event] || []).push(cb);
    return req;
  };
  req.destroy = () => {};
  // Schedule body emit on next microtask so readBody's listeners attach first
  Promise.resolve().then(() => {
    if (body !== undefined) {
      const text = typeof body === "string" ? body : JSON.stringify(body);
      (handlers.data || []).forEach((cb) => cb(Buffer.from(text)));
    }
    (handlers.end || []).forEach((cb) => cb());
  });
  return req;
}

function makeRes(): { res: any; getStatus: () => number; getBody: () => any } {
  let status = 0;
  let bodyText = "";
  let headers: Record<string, string> = {};
  const res: any = {
    headersSent: false,
    writeHead: (s: number, h?: Record<string, string>) => {
      status = s;
      if (h) headers = { ...headers, ...h };
      res.headersSent = true;
    },
    setHeader: (k: string, v: string) => { headers[k] = v; },
    end: (chunk?: string) => { if (chunk) bodyText = chunk; },
  };
  return {
    res,
    getStatus: () => status,
    getBody: () => {
      try { return JSON.parse(bodyText); } catch { return bodyText; }
    },
  };
}

describe("test-cases routes (integration)", () => {
  let root: string;
  let router: Router;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "vskill-tc-routes-"));
    // Pre-create a plugin/skill scaffold the way resolveSkillDir expects.
    // We mirror the layout used elsewhere in the suite: <root>/plugins/<plugin>/skills/<skill>/SKILL.md
    // and also <root>/skills/<skill>/SKILL.md as fallbacks; but simplest is to create inside the
    // first match: <root>/plugins/test-plugin/skills/test-skill.
    const pluginDir = join(root, "plugins", "test-plugin", "skills", "test-skill");
    mkdirSync(pluginDir, { recursive: true });
    router = new Router();
    registerRoutes(router, root);
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  function writeSkillMd(content: string): string {
    const path = join(root, "plugins", "test-plugin", "skills", "test-skill", "SKILL.md");
    writeFileSync(path, content, "utf-8");
    return path;
  }

  function readSkillMd(): string {
    return readFileSync(join(root, "plugins", "test-plugin", "skills", "test-skill", "SKILL.md"), "utf-8");
  }

  it("T-009: GET returns parsed prompts when ## Test Cases section exists", async () => {
    writeSkillMd(`---
name: test-skill
---

## Test Cases

- Prompt: "do the thing"
  Expected: "should activate"
- Prompt: "ignore this"
  Expected: "should not activate"
`);
    const { res, getStatus, getBody } = makeRes();
    const matched = await router.handle(
      makeReq("GET", "/api/skills/test-plugin/test-skill/test-cases"),
      res,
    );
    expect(matched).toBe(true);
    expect(getStatus()).toBe(200);
    const body = getBody();
    expect(body.source).toBe("skill-md");
    expect(body.prompts).toHaveLength(2);
    expect(body.prompts[0]).toEqual({ prompt: "do the thing", expected: "should_activate" });
    expect(body.prompts[1]).toEqual({ prompt: "ignore this", expected: "should_not_activate" });
  });

  it("T-010: GET returns empty list with source=null when no ## Test Cases", async () => {
    writeSkillMd(`---
name: test-skill
---

# Test Skill
Some prose, no test cases.
`);
    const { res, getStatus, getBody } = makeRes();
    const matched = await router.handle(
      makeReq("GET", "/api/skills/test-plugin/test-skill/test-cases"),
      res,
    );
    expect(matched).toBe(true);
    expect(getStatus()).toBe(200);
    expect(getBody()).toEqual({ prompts: [], source: null });
  });

  it("T-011: PUT writes a SKILL.md whose round-trip parse equals the input", async () => {
    writeSkillMd(`---
name: test-skill
---

# Test Skill
`);
    const newPrompts = [
      { prompt: "p1", expected: "should_activate" as const },
      { prompt: "p2", expected: "auto" as const },
    ];
    const { res, getStatus, getBody } = makeRes();
    const matched = await router.handle(
      makeReq("PUT", "/api/skills/test-plugin/test-skill/test-cases", { prompts: newPrompts }),
      res,
    );
    expect(matched).toBe(true);
    expect(getStatus()).toBe(200);
    expect(getBody()).toEqual({ ok: true, count: 2 });

    const onDisk = readSkillMd();
    expect(parseTestCases(onDisk)).toEqual(newPrompts);
  });

  it("T-012: PUT preserves frontmatter and other body sections", async () => {
    const original = `---
name: test-skill
description: A test skill.
---

# Test Skill

## Workflow

Workflow body.

## Examples

Examples body.
`;
    writeSkillMd(original);
    const newPrompts = [{ prompt: "x", expected: "should_activate" as const }];
    const { res } = makeRes();
    await router.handle(
      makeReq("PUT", "/api/skills/test-plugin/test-skill/test-cases", { prompts: newPrompts }),
      res,
    );

    const updated = readSkillMd();
    // Frontmatter preserved
    expect(updated).toMatch(/^---\nname: test-skill\ndescription: A test skill\.\n---\n/);
    // Body sections preserved
    expect(updated).toContain("## Workflow\n\nWorkflow body.");
    expect(updated).toContain("## Examples\n\nExamples body.");
    // New section present
    expect(updated).toContain('## Test Cases');
    expect(parseTestCases(updated)).toEqual(newPrompts);
  });
});
