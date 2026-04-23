# vSkill Studio — Architecture & Testing Guide

**Last updated**: 2026-04-23
**Target audience**: developers running or extending the studio
**Live package**: [`vskill` on npm](https://www.npmjs.com/package/vskill) (current: `v0.5.84`)

---

## 1. Quick start

```bash
npx vskill@latest studio
```

The `@latest` tag is important — plain `npx vskill` caches aggressively and may launch a stale version. The `@latest` pin forces npx to check the registry first.

Default: opens the studio at `http://localhost:3162`.

Also valid:
```bash
# If you've installed globally
npm i -g vskill
vskill studio

# Dev mode from source (hot reload)
cd repositories/anton-abyzov/vskill
npm run dev:eval-ui   # UI at localhost:3078
# In a second terminal:
node dist/index.js eval serve --root .   # API at localhost:3077
```

---

## 2. Process topology

`npx vskill studio` boots two concurrent processes:

```
                     ┌──────────────────────────────┐
                     │  node dist/index.js eval     │
                     │  serve (eval-server)         │
                     │  Port: 3077                  │
                     │  ─────────────────────────── │
                     │  REST + SSE endpoints        │
                     │  Scans filesystem for skills │
                     │  Runs evals / benchmarks     │
                     │  Provider adapters → LLM APIs│
                     └──────────┬───────────────────┘
                                │ proxy /api
                                ▼
                     ┌──────────────────────────────┐
                     │  Static dist/eval-ui/        │
                     │  served on port 3162         │
                     │  ─────────────────────────── │
                     │  Vite 6 + React 19           │
                     │  Tailwind 4 + warm-neutral   │
                     │  palette (see ADR-0674-01)   │
                     │  Routes via react-router v7  │
                     └──────────────────────────────┘
```

Source layout (key paths inside the `vskill` repo):
- `src/eval/` — evaluation engine: comparator (A/B skill-on/off), benchmark runner, LLM provider adapters, skill scanner (`classifyOrigin()` is the Own-vs-Installed SSoT).
- `src/eval-server/` — HTTP server. Routes in `api-routes.ts`, skill creation in `skill-create-routes.ts`, skill improvement in `improve-routes.ts`, SSE helpers in `sse-helpers.ts`.
- `src/eval-ui/` — Vite SPA. Shell in `App.tsx`, sidebar at `src/components/Sidebar.tsx`, detail panel at `src/components/RightPanel.tsx`, update management UI at `src/pages/UpdatesPanel.tsx`.
- `src/bin.ts` — CLI entry (`vskill` binary).
- `scripts/` — CI scripts: `check-no-shimmer.ts`, `check-serif-scope.ts`, `check-bundle-size.ts`, `check-strings-voice.ts`.

---

## 3. REST endpoints (port 3077)

All routes prefixed with `/api`. The UI talks to them via `src/eval-ui/src/api.ts`.

### Skills — metadata & listing
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/skills` | List all skills with `SkillInfo` (origin, frontmatter, filesystem stats, deps, source agent). Primary data source for the sidebar + detail panel. |
| `GET` | `/api/config` | Project root, active model, health status. Used by `ConfigContext`. |

### Skills — version & update management
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/skills/updates` | Returns `SkillUpdateInfo[]` — wraps `vskill outdated --json`. Each entry has `installed`, `latest`, `updateAvailable`, `pinned`, `changelog` fields. **Drives the notification badge proposed in 0681.** |
| `GET` | `/api/skills/:plugin/:skill/versions` | Full version history for one skill. |
| `POST` | `/api/skills/:plugin/:skill/update` | **SSE stream** — updates a single installed skill. Emits `progress`, `done`, `error` events. |
| `POST` | `/api/skills/batch-update` | SSE stream — updates multiple skills in parallel. |
| `GET` | `/api/skills/:plugin/:skill/version-diff` | Diff between two versions. |

### Evaluation & benchmarking
| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/skills/:plugin/:skill/generate-evals` | AI-generate test cases. Body: `{ provider, model, prompt }`. Synchronous. |
| `POST` | `/api/skills/:plugin/:skill/baseline` | Run prompts without the skill. |
| `POST` | `/api/skills/:plugin/:skill/compare` | **The A/B primitive.** Runs the same prompts with AND without the skill, returns `winner: "skill"\|"baseline"\|"tie"` plus per-case pass rates and rubric scores. Called by `ComparisonPage.tsx`. |
| `POST` | `/api/skills/:plugin/:skill/benchmark/case/:evalId` | Run one test case. |
| `GET` | `/api/skills/:plugin/:skill/history` | Benchmark history. |
| `GET` | `/api/skills/:plugin/:skill/history-compare` | Compare two historical runs. |

### Skill improvement
| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/skills/:plugin/:skill/improve` | **SSE** — AI-suggested improvements to SKILL.md body + test cases. |
| `POST` | `/api/skills/:plugin/:skill/apply-improvement` | Commits an improvement to disk. |

### Skill creation
| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/skills` | Create a new skill (body: `{ name, description, provider, model }`). Planned: expose source-model picker in UI (increment 0678). |

---

## 4. Server-Sent Events (SSE)

vskill uses **SSE, not WebSockets**. The client consumes events via the browser-native `EventSource` API.

### Endpoints that stream

| Endpoint | Event types emitted |
|---|---|
| `GET /api/events` | `benchmark:complete`, `history:written`, `leaderboard:updated` — global data-event bus. |
| `POST /api/skills/:plugin/:skill/compare` (when `?sse=1`) | `progress`, `case:start`, `case:done`, `comparison:done`, `error` |
| `POST /api/skills/:plugin/:skill/benchmark/...` | Similar per-case progress stream |
| `POST /api/skills/:plugin/:skill/update` | `progress` (status: `updating` / `scanning` / `installing`), `done`, `error` |
| `POST /api/skills/:plugin/:skill/improve` | `progress`, `patch`, `done`, `error` |
| `POST /api/skills/batch-update` | Per-skill progress frames |

### Testing an SSE endpoint from the terminal

```bash
# 1. Boot the studio (or just the backend)
node dist/index.js eval serve --root .

# 2. In another shell, subscribe to global events
curl -N http://localhost:3077/api/events

# 3. Trigger a skill update — watch events flow in the first shell
curl -N -X POST \
  http://localhost:3077/api/skills/personal/tax-filing/update \
  -H "Content-Type: application/json" \
  -d '{}'

# 4. Simulate comparison streaming (returns plain JSON by default; add ?sse=1 for streaming)
curl -N -X POST 'http://localhost:3077/api/skills/personal/tax-filing/compare?sse=1' \
  -H "Content-Type: application/json" \
  -d '{"provider":"claude-cli","model":"sonnet","prompts":["hello"]}'
```

`-N` disables curl's output buffering so SSE frames appear as they arrive.

### Frame shape
```
event: progress
data: {"status":"updating","skill":"tax-filing","pct":12}

event: done
data: {"installed":"1.2.3","newVersion":"1.3.0","filesChanged":14}

event: error
data: {"message":"network timeout","retriable":true}
```

### Heartbeats
Long streams include heartbeat comments every ~30s (`: heartbeat\n\n`) to keep proxies from dropping the connection. Heartbeats are ignored by `EventSource`.

---

## 5. LLM provider adapters

Configured in `src/eval/llm.ts`. Current providers:

| Provider | Adapter | Env var | Notes |
|---|---|---|---|
| `claude-cli` | shells out to `claude` binary | — (uses Claude Code session) | Default — zero config inside Claude Code. **April 2026: Third-party OAuth token scraping banned; official CLI delegation is still allowed.** |
| `anthropic` | Anthropic SDK | `ANTHROPIC_API_KEY` | Direct API access. Requires key from [platform.claude.com/settings/keys](https://platform.claude.com/settings/keys). |
| `openrouter` | OpenAI-compat SDK | `OPENROUTER_API_KEY` | 300+ models. |
| `ollama` | REST to `localhost:11434` | `OLLAMA_BASE_URL` *(normalization to `OLLAMA_HOST` pending in 0680)* | Detection probes `GET /api/tags` with 30s cache. Uses `/api/chat` for system+user messages. |
| `codex-cli` | shells out to OpenAI Codex CLI | — | |
| `gemini-cli` | shells out to Google Gemini CLI | — | |
| `lmstudio` *(planned 0677)* | OpenAI-compat via SDK | `LM_STUDIO_BASE_URL` (default `http://localhost:1234/v1`) | Detection probes `GET /v1/models`, 500ms timeout. |

### Verified model IDs (April 2026)

| Model ID | Context | $/MTok in-out |
|---|---|---|
| `claude-opus-4-7` | 1M | 5 / 25 |
| `claude-opus-4-6` | 1M | 5 / 25 |
| `claude-sonnet-4-6` | 1M | 3 / 15 |
| `claude-haiku-4-5-20251001` | ~200K | 1 / 5 |

*Sonnet 4.7 and Opus 4.7 — Opus 4.7 confirmed April 16, 2026; Sonnet 4.7 not currently available.*

---

## 6. Test procedure

### Unit + integration (Vitest)
```bash
cd repositories/anton-abyzov/vskill
npx vitest run src/eval-ui        # 988+ tests across ~103 files
npx vitest run src/eval-server    # server-side tests
npx vitest run src/eval           # engine tests
```
Target coverage: 90% (per `.specweave/config.json`).

### Type-check
```bash
npx tsc --noEmit
```

### Playwright E2E
```bash
# One-time
npx playwright install chromium

# Run all specs
npx playwright test

# Single spec
npx playwright test e2e/theme-persistence.spec.ts

# UI mode for interactive debugging
npx playwright test --ui
```
Specs live in `e2e/`. The config boots the studio on port 3077 via `webServer` directive. See `playwright.config.ts`.

### CI gate scripts
```bash
npm run lint:shimmer       # no shimmer animations anywhere in eval-ui
npm run lint:serif-scope   # serif typeface only in allowed selectors
npm run lint:bundle-size   # initial chunk ≤ 250KB gzipped
npm run lint:voice         # no "oops"/"awesome"/celebration emoji in strings.ts
```

### Manual smoke
```bash
# 1. Backend only
node dist/index.js eval serve --root .
curl http://localhost:3077/api/skills | jq '.[0]'
curl http://localhost:3077/api/skills/updates | jq

# 2. Full studio
npx vskill@latest studio
# → browse http://localhost:3162, click a skill, switch Overview ↔ Versions, press / to search, Cmd+K for palette, ? for shortcuts
```

---

## 7. Skill update detection (status + planned 0681 surface)

**Backend is already built**:
- `vskill outdated --json` scans installed skills against their remote source.
- `GET /api/skills/updates` wraps that and returns structured `SkillUpdateInfo[]`.
- `POST /api/skills/:plugin/:skill/update` updates a single skill via SSE.
- `src/eval-ui/src/pages/UpdatesPanel.tsx` renders a full updates page with bulk actions + changelog preview.

**UI surfacing is the gap — planned in increment `0681-studio-update-notifications`**:
- Count badge on the Installed section header: `Installed · Claude · 3 updates ▾`.
- Small `↑` indicator glyph on each outdated `SkillRow` (amber `--color-own`).
- Notification icon in `TopRail` when updates are available, opens a dropdown summary.
- "Update to X.Y.Z" button in the detail panel `RightPanel` when a skill is outdated.
- Icons generated via Gemini 3 Pro Image (Nano Banana Pro).

---

## 8. Release process

Patch release is automated via the `sw:npm` skill. Manual steps:
```bash
git commit -m "feat(studio): <change>"
npm version patch
npm run build && npm run build:eval-ui
npm publish --registry https://registry.npmjs.org
git push origin main --follow-tags
```

Version bumps follow semver:
- `patch` (0.5.83 → 0.5.84) — bug fixes, cosmetic updates
- `minor` (0.5.x → 0.6.0) — new features, new providers
- `major` (0.x.x → 1.0.0) — breaking API or CLI changes

Recent releases:
- `v0.5.83` — warm-neutral UI redesign (increment 0674)
- `v0.5.84` — hotfix: restore `.skeleton` as static alias so loading skeletons render again

---

## 9. Where to look next

- **Increment specs** (source of truth for what's planned / built): `.specweave/increments/` at the umbrella root `specweave-umb/`.
- **ADRs**: `.specweave/docs/internal/architecture/adr/0674-0{1,2,3,4}-*.md` (theme tokens, sidebar classification, typography, Tailwind 4 `@theme`).
- **Test reports**: `e2e/playwright-verification-report.md`, `e2e/llm-integration-report.md` (generated by verifier agents).
- **Shipped increments touching this studio**: `0674-vskill-studio-redesign` (closed), `0675-skill-creator-detection-hotfix`, planned `0677-lm-studio-provider`, `0678-skill-gen-source-model-picker`, `0679-skills-spec-compliance`, `0680-studio-model-access-reform`, `0681-studio-update-notifications`.

---

## 10. Contributing

Follow the SpecWeave loop for any non-trivial change: `sw:increment` → `sw:do` → `sw:done`. Every task has a Test Plan. Every AC is traceable.

Questions? Open an issue on [`anton-abyzov/vskill`](https://github.com/anton-abyzov/vskill) or check the active increments at the umbrella root.
