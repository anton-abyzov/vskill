# Fallback modes

Exact detection commands and warning messages for the A → B → C
fallback transitions. These mirror the detection script in `SKILL.md`
line-for-line — keep them in sync. If you edit one, edit the other in
the same commit.

## Path A — vskill CLI (preferred)

**Probe:**

```bash
which vskill >/dev/null 2>&1
```

**On success, invoke:**

```bash
vskill skill new --prompt "<USER_PROMPT>" [--targets=<csv>]
```

Default `--targets` is the full universal set (8 agents — see
`target-agents.md`). No warning is emitted; this is the happy path.

## Path B — vskill package present, no CLI

**Probe:**

```bash
node -e "require.resolve('vskill')" >/dev/null 2>&1
```

**On success, invoke:**

```bash
vskill eval serve
```

**Warning emitted to stdout** (the host agent should surface this to
the user verbatim):

```
[skill-builder] open the URL printed above and use the Studio 'New skill' flow
```

## Path C — Anthropic skill-creator (Claude Code only)

**Probe:**

```bash
[ "${SW_HOST_AGENT:-claude-code}" = "claude-code" ] \
  && test -d "$HOME/.claude/skills/skill-creator"
```

**On success, emit exactly this warning before delegating:**

```
[skill-builder] fallback mode — universal targets not emitted; install vskill for universal support
```

The wording is load-bearing: test gates grep for the literal
`fallback mode — universal targets not emitted` substring to confirm
Path C activated. Do NOT reword.

## No path matches — remediation

If all three probes fail, print this block and exit with code 1:

```
[skill-builder] no authoring backend available. Install one of:

  npm install -g vskill          # preferred — universal targets
  claude plugin install skill-creator   # Claude Code only, no universal emit

```

The blank trailing line is intentional — makes the block visually
distinct when the host agent renders it.
