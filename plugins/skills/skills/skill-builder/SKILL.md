---
name: skill-builder
description: >
  Meta-skill for creating new skills from natural language. Trigger phrases:
  "new skill", "create a skill", "build a skill", "make a skill",
  "generate a skill", "author a skill", "skill builder".
metadata:
  version: 1.0.3
  homepage: https://verified-skill.com/skills/skill-builder
  tags:
    - skill-authoring
    - meta
    - universal
---

# skill-builder

Author new universal skills from natural-language prompts across any agent
host (Claude Code, Cursor, Codex, Gemini CLI, Windsurf, OpenCode, and the
rest of the 50+ agents in the vskill registry).

## What this skill does

`skill-builder` is a cross-tool authoring meta-skill. When the host agent
sees a trigger phrase (see frontmatter `description`), this skill takes
over and produces a new SKILL.md — emitted for every target agent, not
just the one currently invoking it. The emitted skills carry an
`x-sw-schema-version: 1` marker so future tooling can evolve the format
without breaking older installs.

It does this by delegating to the real generator via a three-path
fallback chain:

- **Path A — `vskill skill` CLI** (preferred). The CLI owns the full
  authoring pipeline: prompt parsing, target-agent lowering, divergence
  report, security scan, and disk write.
- **Path B — vskill Studio (browser)**. When the CLI is not on PATH but
  the npm package is present (e.g. a project-local install), start the
  eval server and walk the user through the Studio UI.
- **Path C — Anthropic `skill-creator`** (Claude Code only fallback).
  Delegate to the built-in Anthropic authoring skill. This produces a
  single Claude-flavored SKILL.md with no universal targets, so we log
  the degradation so users know what they're getting.

Each path is tried in order; the first one whose detection check
succeeds wins. If none match, we emit a remediation message and stop.

## Detection script

The host agent runs this snippet (or the equivalent) before authoring
anything. Return on the first path whose probe exits 0.

```bash
# Path A: vskill CLI on PATH
if which vskill >/dev/null 2>&1; then
  # Invoke the CLI. --targets is optional; default is the full
  # universal set. --prompt is the user's natural-language request.
  vskill skill new --prompt "<USER_PROMPT>" [--targets=<csv>]
  exit $?
fi

# Path B: vskill package resolvable but no CLI on PATH
if node -e "require.resolve('vskill')" >/dev/null 2>&1; then
  vskill eval serve
  echo "[skill-builder] open the URL printed above and use the Studio 'New skill' flow"
  exit 0
fi

# Path C: Claude Code host with Anthropic skill-creator installed
if [ "${SW_HOST_AGENT:-claude-code}" = "claude-code" ] \
   && test -d "$HOME/.claude/skills/skill-creator"; then
  echo "[skill-builder] fallback mode — universal targets not emitted; install vskill for universal support"
  # Delegate to the Anthropic built-in. The host agent will route
  # the original user prompt into skill-creator.
  exit 0
fi

# Nothing matched — print remediation and fail loudly.
cat <<'EOF'
[skill-builder] no authoring backend available. Install one of:

  npm install -g vskill          # preferred — universal targets
  claude plugin install skill-creator   # Claude Code only, no universal emit

EOF
exit 1
```

Notes for the host agent:

- `<USER_PROMPT>` is the user's raw natural-language request.
- `<csv>` for `--targets` is a comma-separated list of agent IDs
  (e.g. `claude-code,codex,cursor`). Omit to default to the full
  universal set.
- `SW_HOST_AGENT` is the environment hint set by the invoking tool.
  When unset, assume `claude-code` — that is the only host that ships
  `skill-creator` as a built-in, so the default is safe.
- The log line in Path C is intentionally exact; test gates grep for
  it to confirm fallback activation.

## Sentinel file contract

Path A MUST write a sentinel file to the current working directory so
test gates and manual verification can confirm activation without
parsing CLI stdout. The file is:

```
.skill-builder-invoked.json
```

With shape:

```json
{
  "trigger": "new skill",
  "agent": "claude-code",
  "timestamp": "2026-04-24T14:35:00.000Z",
  "targets": ["claude-code", "codex", "cursor"],
  "prompt": "lint markdown files for broken links"
}
```

Field definitions:

- `trigger` — the exact phrase that activated `skill-builder`
  (e.g. `"new skill"`, `"create a skill"`).
- `agent` — the host agent id that invoked us
  (`claude-code`, `cursor`, `codex`, etc.).
- `timestamp` — ISO-8601 UTC timestamp at invocation.
- `targets` — the resolved target agent IDs the CLI will emit for.
  Defaults to the full universal set when the user did not pass
  `--targets`.
- `prompt` — the raw user prompt passed to the CLI.

Paths B and C do NOT write the sentinel — they have their own
verification surfaces (Studio UI state for B, Claude Code's native
skill-creator log for C). Consumers that need "did skill-builder
activate?" gating must check the sentinel AND tolerate its absence
in fallback modes.

## What this is NOT

- **Not `scout`** — `scout` is for DISCOVERING skills that already
  exist on the verified-skill.com registry ("find me a kubernetes
  skill"). `skill-builder` is for CREATING new skills from a prompt.
  If the user's intent is "find" or "install" rather than "make",
  route to `scout` instead.
- **Not `sw:skill-gen`** — `sw:skill-gen` is the SpecWeave command
  for signal-based skill GENERATION: it reads patterns from living
  docs and emits project-specific skills. That flow is automatic
  and pattern-driven, whereas `skill-builder` is interactive and
  prompt-driven. Use `sw:skill-gen` inside a SpecWeave project when
  you want skills derived from detected code patterns.

In short:

| Intent                               | Skill              |
|--------------------------------------|--------------------|
| "find me a skill for X"              | `scout`            |
| "generate skills from my codebase"   | `sw:skill-gen`     |
| "make a new skill from this prompt"  | `skill-builder`    |

## References

- [`references/target-agents.md`](references/target-agents.md) —
  the full target agent table with universality flags and local
  skills dirs, sourced from `src/agents/agents-registry.ts`.
- [`references/divergence-report-schema.md`](references/divergence-report-schema.md) —
  the format spec for per-skill `<name>-divergence.md` files that
  document frontmatter fields dropped or translated per target.
- [`references/fallback-modes.md`](references/fallback-modes.md) —
  the exact detection commands and exact warning messages for the
  A → B → C transitions, mirrored from this file so the two stay
  in sync.
