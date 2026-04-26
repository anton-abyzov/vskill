# Changelog

## [0.5.111] - 2026-04-25

### Fixed
- **0732**: ID-format dual-accept for SSE skill-update notifications — the platform now augments every `skill.updated` event with both UUID (`skillId`) and public slug (`skillSlug`). Studio clients subscribed via slug-ID (the format returned by the discovery API) now receive update notifications correctly without UUID knowledge. The `greet-anton` skill (`anton-abyzov/vskill/greet-anton`) is verified against production SSE.

## [Unreleased]

### Fixed
- **0733**: Studio skill list now filters by the picker-selected agent on first load. Previously, a fresh session with empty localStorage rendered 108 skills (including buckets for `.aider/`, `.cursor/`, `.gemini/`, `.kiro/`, `.openclaw/`, `.pi/`, `.windsurf/`, etc.) even when the picker showed Claude Code, because (a) `App.tsx` hydrated the suggested-agent fallback into React state only — never persisting it or dispatching `studio:agent-changed`; (b) `StudioContext` had no fallback path of its own, so its first `/api/skills` request omitted `?agent=`; (c) the server filter at `api-routes.ts:1700` used the raw query param, so it no-op'd when `?agent=` was absent. Fix applies in all three places: server now passes the resolved active agent into the filter, App.tsx routes the suggested-fallback through `handleActiveAgentChange`, and StudioContext bootstraps from `/api/agents` when localStorage is empty before issuing its first skill fetch.

### Added
- `vskill skill` CLI subcommand family (new | import | list | info | publish) for creating and managing universal cross-tool skills
- Bundled `skill-builder` meta-skill with path A/B/C fallback chain (CLI → browser Studio → Anthropic skill-creator)
- `x-sw-schema-version: 1` on every emitted skill's frontmatter for future compatibility
- Per-skill `<name>-divergence.md` report listing frontmatter fields dropped or translated per target
