// ---------------------------------------------------------------------------
// 0698 T-007: scope rename ripple + strings.ts labels.
//
// Adds Anthropic-aligned labels under `strings.scopeLabels`:
//   group:  AVAILABLE / AUTHORING
//   source: Project / Personal / Plugins / Skills
//
// The full ripple (sidebar renders using these new labels, absence of legacy
// strings from rendered output) is verified by the two-tier Sidebar layout
// test in T-009 once GroupHeader + Sidebar.tsx are restructured.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { strings } from "../strings";

describe("strings.scopeLabels (0698 T-007)", () => {
  it("exports user-facing labels for every sidebar group", () => {
    expect(strings.scopeLabels.groupAvailable).toBe("Available");
    expect(strings.scopeLabels.groupAuthoring).toBe("Authoring");
  });

  it("exports user-facing labels for every source channel", () => {
    expect(strings.scopeLabels.sourceProject).toBe("Project");
    expect(strings.scopeLabels.sourcePersonal).toBe("Personal");
    expect(strings.scopeLabels.sourcePlugin).toBe("Plugins");
    // Skills is the AUTHORING > standalone label (contrast with AUTHORING > Plugins)
    expect(strings.scopeLabels.authoringSkills).toBe("Skills");
  });

  it("uses Anthropic-aligned vocabulary (no legacy Own/Installed/Global/Enterprise/Drafts)", () => {
    const values = Object.values(strings.scopeLabels) as string[];
    for (const v of values) {
      expect(v).not.toBe("Own");
      expect(v).not.toBe("Installed");
      expect(v).not.toBe("Global");
      expect(v).not.toBe("Enterprise");
      expect(v).not.toBe("Drafts");
    }
  });

  it("exactly six labels exported (2 groups + 4 source/authoring variants)", () => {
    const keys = Object.keys(strings.scopeLabels);
    // 2 group labels + 3 source labels + 1 authoring-only skills label = 6
    expect(keys).toHaveLength(6);
    expect(new Set(keys)).toEqual(
      new Set([
        "groupAvailable",
        "groupAuthoring",
        "sourceProject",
        "sourcePersonal",
        "sourcePlugin",
        "authoringSkills",
      ]),
    );
  });
});
