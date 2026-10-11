// Bundle fetching: a skill installed without its scripts/ is broken, not merely
// degraded. 0894: the fixed text-only allowlist is gone — non-root skills get
// their complete folder; repo-root skills get the convention folders, which
// must all be writable under the installer's standard (Studio) path policy.

import { describe, it, expect } from "vitest";
import { ROOT_SKILL_BUNDLE_DIRS } from "../../discovery/github-skill-bundle.js";
import { assertSafeBundlePath } from "../../installer/bundle-files.js";

describe("ROOT_SKILL_BUNDLE_DIRS", () => {
  it("covers only directories the installer's standard policy accepts", () => {
    for (const dir of ROOT_SKILL_BUNDLE_DIRS) {
      expect(() => assertSafeBundlePath(`${dir}/nested/example.md`)).not.toThrow();
    }
  });

  it("includes scripts/ and references/ — the original regression", () => {
    expect(ROOT_SKILL_BUNDLE_DIRS).toContain("scripts");
    expect(ROOT_SKILL_BUNDLE_DIRS).toContain("references");
  });
});
