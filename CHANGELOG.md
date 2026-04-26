# Changelog

## [0.5.111] - 2026-04-25

### Fixed
- **0732**: ID-format dual-accept for SSE skill-update notifications — the platform now augments every `skill.updated` event with both UUID (`skillId`) and public slug (`skillSlug`). Studio clients subscribed via slug-ID (the format returned by the discovery API) now receive update notifications correctly without UUID knowledge. The `greet-anton` skill (`anton-abyzov/vskill/greet-anton`) is verified against production SSE.

## [Unreleased]

### Added
- `vskill skill` CLI subcommand family (new | import | list | info | publish) for creating and managing universal cross-tool skills
- Bundled `skill-builder` meta-skill with path A/B/C fallback chain (CLI → browser Studio → Anthropic skill-creator)
- `x-sw-schema-version: 1` on every emitted skill's frontmatter for future compatibility
- Per-skill `<name>-divergence.md` report listing frontmatter fields dropped or translated per target
