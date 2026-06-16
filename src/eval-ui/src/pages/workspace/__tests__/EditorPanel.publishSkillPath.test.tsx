// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0875 [RED→GREEN] — EditorPanel must pass the active skill's repo-relative
// SKILL.md path to the publish flow.
//
// Bug: EditorPanel rendered <PublishButton> without `skillPath`, so publishing
// a skill that lives in a subdirectory (e.g. "skills/greet-anton/SKILL.md")
// submitted with skillPath:undefined and the registry failed with
// "SKILL.md not found in the repository. Add a SKILL.md file to the repo root
// (or specify skillPath)".
//
// Fix: EditorPanel resolves the active skill's `skillPath` from
// useStudio().state.skills (matching on plugin+skill) and forwards it as the
// `skillPath` prop, mirroring how the other entry points carry SkillInfo.skillPath.
//
// Strategy (mirrors 0800-editor-runall.test.tsx): mock the React hooks and all
// of EditorPanel's context/hook dependencies, mock <PublishButton> to a marker
// element that records its props, then call EditorPanel() as a function and walk
// the materialised tree to assert the PublishButton received the resolved path.
//
// This test FAILS on the old behaviour (no skillPath prop → skillPath:undefined)
// and PASSES on the fixed behaviour.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Active workspace skill + the Studio SkillInfo list it resolves against ---
const ACTIVE_PLUGIN = "vskill";
const ACTIVE_SKILL = "greet-anton";
const ACTIVE_SKILL_PATH = "skills/greet-anton/SKILL.md";

const mockWorkspaceState: Record<string, unknown> = {
  plugin: ACTIVE_PLUGIN,
  skill: ACTIVE_SKILL,
  // Minimal SKILL.md content — parseFrontmatter must not throw on it.
  skillContent: "---\nname: greet-anton\nversion: 1.0.0\n---\n\nBody",
  savedContent: "---\nname: greet-anton\nversion: 1.0.0\n---\n\nBody",
  isDirty: false,
  improveTarget: null,
  aiEditOpen: false,
  evals: { skill_name: ACTIVE_SKILL, evals: [] as unknown[] },
};

// Studio skill list — includes the active skill carrying its repo-relative
// skillPath, exactly like the real /api/skills payload.
let mockStudioSkills: Array<Record<string, unknown>> = [
  { plugin: ACTIVE_PLUGIN, skill: ACTIVE_SKILL, skillPath: ACTIVE_SKILL_PATH, origin: "source" },
  { plugin: "other", skill: "noise", skillPath: "skills/noise/SKILL.md", origin: "source" },
];

// NOTE: vi.mock paths resolve relative to THIS test file
// (pages/workspace/__tests__/), not relative to EditorPanel.tsx.
vi.mock("../WorkspaceContext", () => ({
  useWorkspace: () => ({
    state: mockWorkspaceState,
    dispatch: vi.fn(),
    saveContent: vi.fn(),
    isReadOnly: false,
    canEdit: true,
  }),
}));

vi.mock("../../../StudioContext", () => ({
  useStudio: () => ({ state: { skills: mockStudioSkills } }),
}));

vi.mock("../../../ConfigContext", () => ({
  useConfig: () => ({ config: { provider: "claude-cli", model: "sonnet" } }),
}));

// useGitRemote must report a remote so the PublishButton branch renders.
vi.mock("../../../hooks/useGitRemote", () => ({
  useGitRemote: () => ({
    hasRemote: true,
    remoteUrl: "git@github.com:owner/repo.git",
    branch: "main",
    loading: false,
    error: null,
  }),
}));

// useSkillFiles — return SKILL.md as the active file so the editor body and the
// toolbar (which hosts <PublishButton>) render.
vi.mock("../useSkillFiles", () => ({
  useSkillFiles: () => ({
    files: [{ path: "SKILL.md", name: "SKILL.md" }],
    activeFile: "SKILL.md",
    secondaryContent: null,
    loading: false,
    error: null,
    loadError: null,
    selectFile: vi.fn(),
    refresh: vi.fn(),
    isSkillMd: true,
  }),
}));

// Heavy children that aren't under test — stub to inert nodes.
vi.mock("../TestsPanel", () => ({ TestsPanel: () => null }));
vi.mock("../../../components/SkillImprovePanel", () => ({ SkillImprovePanel: () => null }));
vi.mock("../../../components/AiEditBar", () => ({ AiEditBar: () => null }));
vi.mock("../../../components/ProgressLog", () => ({ ProgressLog: () => null }));
vi.mock("../../../components/SkillFileBrowser", () => ({ SkillFileBrowser: () => null }));
vi.mock("../../../components/SecondaryFileViewer", () => ({ SecondaryFileViewer: () => null }));

// <PublishButton> — replaced by a stable marker component so we can locate its
// element in EditorPanel()'s returned tree by `type` and read the props it was
// given. We do NOT rely on render-time prop capture: calling EditorPanel() as a
// plain function materialises element descriptors but does not execute child
// component functions, so the props must be read off the element itself.
// vi.hoisted lets the marker be referenced inside the hoisted vi.mock factory.
const { MockPublishButton } = vi.hoisted(() => ({
  MockPublishButton: (_props: Record<string, unknown>) => null,
}));
vi.mock("../../../components/PublishButton", () => ({
  PublishButton: MockPublishButton,
}));

// Mirror 0800-editor-runall: neutralise the React hooks so EditorPanel() can be
// invoked as a plain function returning its element tree.
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (init: unknown) => [typeof init === "function" ? (init as () => unknown)() : init, vi.fn()],
    useEffect: () => {},
    useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
    useRef: (init: unknown) => ({ current: init }),
    Fragment: actual.Fragment,
  };
});

import { EditorPanel } from "../EditorPanel";

type ReactEl = { type: unknown; props: Record<string, unknown> };

function collectElements(node: unknown, match: (el: ReactEl) => boolean): ReactEl[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((c) => collectElements(c, match));
  const el = node as ReactEl;
  const results: ReactEl[] = [];
  if (el.type != null && match(el)) results.push(el);
  if (el.props?.children != null) results.push(...collectElements(el.props.children, match));
  return results;
}

/** Find the single PublishButton element EditorPanel renders and return props. */
function findPublishButtonProps(): Record<string, unknown> {
  const tree = EditorPanel();
  const matches = collectElements(tree, (el) => el.type === MockPublishButton);
  expect(matches.length).toBe(1);
  return matches[0].props;
}

describe("EditorPanel — forwards active skill's skillPath to PublishButton", () => {
  beforeEach(() => {
    mockStudioSkills = [
      { plugin: ACTIVE_PLUGIN, skill: ACTIVE_SKILL, skillPath: ACTIVE_SKILL_PATH, origin: "source" },
      { plugin: "other", skill: "noise", skillPath: "skills/noise/SKILL.md", origin: "source" },
    ];
  });

  it("passes the repo-relative SKILL.md path resolved from useStudio", () => {
    const props = findPublishButtonProps();
    // CORE regression assertion — fails on the OLD behaviour (no skillPath prop).
    expect(props.skillPath).toBe(ACTIVE_SKILL_PATH);
    // skillName must also be the active skill so the in-app submit path runs.
    expect(props.skillName).toBe(ACTIVE_SKILL);
  });

  it("wires remoteUrl + public privacy on the same PublishButton (sanity)", () => {
    const props = findPublishButtonProps();
    expect(props.remoteUrl).toBe("git@github.com:owner/repo.git");
    expect(props.privacy).toBe("public");
  });

  it("falls back to undefined skillPath for a flat-layout skill at repo root", () => {
    // Flat layout: no skillPath in the SkillInfo list → submit omits skillPath
    // and the registry uses the repo root. This must NOT break.
    mockStudioSkills = [
      { plugin: ACTIVE_PLUGIN, skill: ACTIVE_SKILL, skillPath: undefined, origin: "source" },
    ];
    const props = findPublishButtonProps();
    expect(props.skillPath).toBeUndefined();
    expect(props.skillName).toBe(ACTIVE_SKILL);
  });

  it("ignores skillPath from a non-matching skill in the Studio list", () => {
    // The resolver must match on BOTH plugin and skill — picking the active
    // skill's path, never a sibling's. Put a decoy first.
    mockStudioSkills = [
      { plugin: "other", skill: ACTIVE_SKILL, skillPath: "wrong/path/SKILL.md", origin: "source" },
      { plugin: ACTIVE_PLUGIN, skill: ACTIVE_SKILL, skillPath: ACTIVE_SKILL_PATH, origin: "source" },
    ];
    const props = findPublishButtonProps();
    expect(props.skillPath).toBe(ACTIVE_SKILL_PATH);
  });
});
