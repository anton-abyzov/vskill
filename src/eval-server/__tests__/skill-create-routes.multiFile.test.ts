// 0815: skill-create-routes — resolveSafe + buildEnvExample + multi-file payload.

import { describe, it, expect } from "vitest";
import { resolveSafe, buildEnvExample } from "../skill-create-routes.js";
import { resolve, sep } from "node:path";

describe("resolveSafe", () => {
  const base = resolve("/tmp/skill-x");

  it("accepts a normal relative path", () => {
    const out = resolveSafe(base, "scripts/audit.py");
    expect(out).toBe(resolve(base, "scripts/audit.py"));
    expect(out.startsWith(base + sep)).toBe(true);
  });

  it("rejects parent traversal", () => {
    expect(() => resolveSafe(base, "../etc/passwd")).toThrow(/traversal/);
    expect(() => resolveSafe(base, "scripts/../../etc/passwd")).toThrow(/traversal/);
  });

  it("rejects POSIX absolute paths", () => {
    expect(() => resolveSafe(base, "/etc/passwd")).toThrow(/absolute/);
  });

  it("rejects Windows drive-letter paths", () => {
    expect(() => resolveSafe(base, "C:\\Windows\\system32\\drivers\\etc\\hosts")).toThrow(/absolute/);
  });

  it("rejects empty input", () => {
    expect(() => resolveSafe(base, "")).toThrow(/empty/);
  });

  it("accepts nested paths inside the skill dir", () => {
    const out = resolveSafe(base, "tests/sub/integration.py");
    expect(out).toBe(resolve(base, "tests/sub/integration.py"));
  });

  it("rejects backslash-encoded traversal", () => {
    expect(() => resolveSafe(base, "scripts\\..\\..\\etc\\passwd")).toThrow(/traversal/);
  });
});

describe("buildEnvExample", () => {
  it("emits one KEY= line per declared secret", () => {
    const out = buildEnvExample(["STRIPE_API_KEY", "GITHUB_TOKEN"]);
    expect(out).toContain("STRIPE_API_KEY=");
    expect(out).toContain("GITHUB_TOKEN=");
    // Never includes a value after the =.
    expect(out).not.toMatch(/=[^\s\n]/);
  });

  it("includes a leading comment header", () => {
    const out = buildEnvExample(["A"]);
    expect(out.startsWith("# .env.example")).toBe(true);
  });

  it("filters out empty/non-string entries defensively", () => {
    // Cast: real callers go through TypeScript, but we want to be safe at runtime.
    const out = buildEnvExample(["KEEP", "", "ALSO_KEEP"] as string[]);
    expect(out).toContain("KEEP=");
    expect(out).toContain("ALSO_KEEP=");
    // Empty entry didn't produce a stray `=`.
    const lines = out.split("\n").filter((l) => l.endsWith("="));
    expect(lines).toEqual(["KEEP=", "ALSO_KEEP="]);
  });
});
