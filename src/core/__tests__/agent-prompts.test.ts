// 0815: agent-prompts JSON parsers — schema validation + path-traversal rejection.

import { describe, it, expect } from "vitest";
import {
  parseScriptResponse,
  parseGraderResponse,
  parseTestResponse,
  parseReferenceResponse,
  SCRIPT_SYSTEM_PROMPT,
  GRADER_SYSTEM_PROMPT,
  TEST_SYSTEM_PROMPT,
  REFERENCE_SYSTEM_PROMPT,
} from "../agent-prompts.js";

describe("agent-prompts: system prompts are non-empty constants", () => {
  it("script/grader/test/reference prompts all defined", () => {
    expect(SCRIPT_SYSTEM_PROMPT).toContain("scripts/");
    expect(GRADER_SYSTEM_PROMPT).toContain("grader");
    expect(TEST_SYSTEM_PROMPT).toContain("integration test");
    expect(REFERENCE_SYSTEM_PROMPT).toContain("references/");
  });
});

describe("parseScriptResponse", () => {
  it("parses valid JSON with files + runtime", () => {
    const json = JSON.stringify({
      files: [{ path: "scripts/audit.py", content: "print('hi')" }],
      runtime: { python: ">=3.10", pip: ["stripe>=8"] },
    });
    const r = parseScriptResponse(json);
    expect(r.files).toHaveLength(1);
    expect(r.files[0].path).toBe("scripts/audit.py");
    expect(r.runtime?.python).toBe(">=3.10");
    expect(r.runtime?.pip).toEqual(["stripe>=8"]);
  });

  it("strips ```json code fences", () => {
    const json = "```json\n" + JSON.stringify({ files: [{ path: "scripts/x.py", content: "" }] }) + "\n```";
    const r = parseScriptResponse(json);
    expect(r.files[0].path).toBe("scripts/x.py");
  });

  it("rejects path traversal", () => {
    const json = JSON.stringify({ files: [{ path: "scripts/../../etc/passwd", content: "" }] });
    expect(() => parseScriptResponse(json)).toThrow(/traversal|unsafe/i);
  });

  it("rejects absolute paths", () => {
    const json = JSON.stringify({ files: [{ path: "/etc/passwd", content: "" }] });
    expect(() => parseScriptResponse(json)).toThrow(/unsafe|absolute/i);
  });

  it("rejects paths outside the scripts/ prefix", () => {
    const json = JSON.stringify({ files: [{ path: "tests/foo.py", content: "" }] });
    expect(() => parseScriptResponse(json)).toThrow(/scripts\//);
  });

  it("rejects malformed JSON with a descriptive error", () => {
    expect(() => parseScriptResponse("not json")).toThrow(/script-agent.*invalid JSON/);
  });

  it("rejects missing files array", () => {
    expect(() => parseScriptResponse(JSON.stringify({}))).toThrow(/missing.*files/);
  });
});

describe("parseGraderResponse", () => {
  it("accepts a single grader file under scripts/", () => {
    const r = parseGraderResponse(JSON.stringify({
      files: [{ path: "scripts/grader.py", content: "def grade(x): return 0.5" }],
    }));
    expect(r.files).toHaveLength(1);
  });

  it("rejects a path under tests/", () => {
    expect(() => parseGraderResponse(JSON.stringify({
      files: [{ path: "tests/foo.py", content: "" }],
    }))).toThrow();
  });
});

describe("parseTestResponse", () => {
  it("parses files + secrets + integrationTests", () => {
    const r = parseTestResponse(JSON.stringify({
      files: [{ path: "tests/integration_test.py", content: "def test_x(): pass" }],
      secrets: ["STRIPE_API_KEY"],
      integrationTests: { runner: "pytest", file: "tests/integration_test.py", requires: ["STRIPE_API_KEY"] },
    }));
    expect(r.files[0].path).toBe("tests/integration_test.py");
    expect(r.secrets).toEqual(["STRIPE_API_KEY"]);
    expect(r.integrationTests?.runner).toBe("pytest");
  });

  it("ignores invalid runner values", () => {
    const r = parseTestResponse(JSON.stringify({
      files: [{ path: "tests/x.py", content: "" }],
      integrationTests: { runner: "make" },
    }));
    expect(r.integrationTests).toBeUndefined();
  });

  it("rejects test files outside tests/", () => {
    expect(() => parseTestResponse(JSON.stringify({
      files: [{ path: "scripts/test_x.py", content: "" }],
    }))).toThrow(/tests\//);
  });
});

describe("parseReferenceResponse", () => {
  it("accepts multiple reference files", () => {
    const r = parseReferenceResponse(JSON.stringify({
      files: [
        { path: "references/a.md", content: "# A" },
        { path: "references/b.md", content: "# B" },
      ],
    }));
    expect(r.files).toHaveLength(2);
  });
});
