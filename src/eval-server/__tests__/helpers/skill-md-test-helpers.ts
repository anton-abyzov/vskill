// ---------------------------------------------------------------------------
// skill-md-test-helpers.ts — 0679 F-004 narrowing
//
// Re-exports the SKILL.md emitter and the test-only frontmatter parser as a
// dedicated test surface. Tests should import from THIS module, not from
// `../skill-create-routes.js` directly. Production code MUST NOT import from
// here — the directory name (`__tests__`) is the boundary.
//
// Why a re-export instead of moving the code: `buildSkillMd` is private to
// `skill-create-routes.ts` and is the canonical emitter for the HTTP route.
// Splitting it would create two emitter sources, the exact problem we're
// trying to avoid. The re-export collapses the test surface to one entry
// point while keeping a single source of truth.
// ---------------------------------------------------------------------------

export {
  buildSkillMdForTest,
  parseFrontmatterForTest,
  type BuildSkillMdInput,
} from "../../skill-create-routes.js";
