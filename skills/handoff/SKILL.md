---
version: "1.0.0"
name: handoff
description: "Hand off your in-flight work to ANY other AI coding tool so you can continue exactly where you left off — works in 8+ tools (Claude Code, Codex, OpenCode, Gemini, Antigravity, Cursor, Aider, Cline/Roo, Windsurf). Writes one portable, secret-scrubbed handoff document plus a full diff of your uncommitted edits, then prints the absolute path, a clickable link, and a copy-paste resume prompt. Use this skill whenever the user is running out of subscription tokens, wants to switch tools mid-task, says 'handoff', 'continue elsewhere', 'continue on another machine', 'switch to Codex/OpenCode/Gemini/Cursor', or 'I'm out of tokens'. Self-contained: needs only git and a shell; uses 'specweave handoff' as an optional accelerator if it is on PATH."
metadata:
  tags: handoff, cross-tool, portable-context, out-of-tokens, switch-tools, resume, session, git-diff, secret-scrub, continue-elsewhere
---

# /handoff — Cross-Tool Work Handoff

No AI coding tool can read another's transcript: Claude Code locks sessions in `~/.claude/projects/<munged-cwd>/<uuid>.jsonl`, Codex/OpenCode in their own stores, Antigravity in encrypted `.pb`. The only thing portable across tools is a **self-contained document**. This skill writes that document — your current goal, decisions, and the EXACT uncommitted edits — so any other AI agent can pick up where you left off, without you re-explaining anything.

**Use this skill when** the user is low on tokens, wants to switch tools mid-task, is moving to another machine, or says "handoff" / "continue elsewhere" / "out of tokens".

This skill is **self-contained**: it works with only `git` + a shell. It calls `specweave handoff` as an *optional accelerator* when that binary is on PATH (high-fidelity, increment-aware) — but it has **no hard dependency** on SpecWeave being installed.

---

## Decision: which path to take

```bash
command -v specweave >/dev/null 2>&1 && echo "ACCELERATOR" || echo "STANDALONE"
```

- **ACCELERATOR** (`specweave` on PATH) → run the engine, surface its output. Go to Path A.
- **STANDALONE** (no `specweave`) → build the doc yourself from `git` + a short interview. Go to Path B.

Both paths emit the **same doc format and the same paste-prompt** (see the canonical template below), so a handoff is continuable in any tool regardless of which path produced it.

---

## Path A — Accelerator (specweave on PATH)

Run the engine, forwarding any short context you can supply cheaply:

```bash
specweave handoff [incrementId] [--reason "..."] [--summary "..."] [--next "..."] [--gotcha "..."] [--decision "..."] [--inline]
```

Then surface its stdout **verbatim, in order** (do not reorder or paraphrase):

1. absolute doc path as plain text (FIRST), 2. clickable markdown link, 3. `.diff` path,
4. fenced copy-paste resume prompt, 5. per-tool "find your source session" tips.

Done. The engine handled workspace detection, task/AC parsing, git capture, the full-diff dump, secret scrub, and rendering.

---

## Path B — Standalone (no specweave)

Build a byte-compatible doc using only the shell.

### B1. Capture git state (free — no tokens)

```bash
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
mkdir -p "$ROOT/.handoff"
printf '*\n' > "$ROOT/.handoff/.gitignore"   # never let the handoff or its diff enter git

BRANCH="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '(no git)')"
SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo '(no commits)')"
STATUS="$(git -C "$ROOT" status --porcelain 2>/dev/null)"
STAT="$(git -C "$ROOT" diff --stat 2>/dev/null)"

# Full uncommitted edits → sibling .diff (working tree + staged), the key fidelity artifact
{ git -C "$ROOT" diff HEAD 2>/dev/null; git -C "$ROOT" diff --cached 2>/dev/null; } > "$ROOT/.handoff/handoff.diff"
```

### B2. Five-question interview (only the non-derivable fields)

Ask the user (keep it to ~5 short strings — cheap even at token exhaustion):

1. **reason** — why are you handing off? (e.g. "out of tokens")
2. **summary** — one line: where do things stand?
3. **next** — the exact next step.
4. **gotcha** — anything the next agent must NOT do / must know?
5. **decisions** — key decisions already made (semicolon-separated).

### B3. Secret scrub (before writing — over BOTH free text AND the diff)

Replace matches with `[REDACTED-<type>]` and count per pattern. Patterns (12):
`sk-`, `ghp_`, `gho_`, `ghs_`, `AKIA`, `ASIA`, `-----BEGIN`, `vsk_`, `xox[bap]-`, `Bearer `, `password=`, `api_key=`.

```bash
# scrub the captured diff in place, e.g.:
sed -i.bak -E \
  -e 's/sk-[A-Za-z0-9_-]+/[REDACTED-sk]/g' \
  -e 's/gh[pos]_[A-Za-z0-9_-]+/[REDACTED-gh-token]/g' \
  -e 's/(A[KS]IA[0-9A-Z]{16})/[REDACTED-aws-key]/g' \
  -e 's/vsk_[A-Za-z0-9_-]+/[REDACTED-vsk]/g' \
  -e 's/xox[bap]-[A-Za-z0-9-]+/[REDACTED-slack]/g' \
  -e 's/Bearer [A-Za-z0-9._-]+/Bearer [REDACTED-bearer]/g' \
  -e 's/(password=)[^[:space:]]+/\1[REDACTED-password]/g' \
  -e 's/(api_key=)[^[:space:]]+/\1[REDACTED-api_key]/g' \
  "$ROOT/.handoff/handoff.diff" && rm -f "$ROOT/.handoff/handoff.diff.bak"
```
Scrubbing is heuristic — an empty redaction list is NOT a guarantee the file is clean.

### B4. Write the doc

Write the canonical template below to `$ROOT/.handoff/HANDOFF.md`, filling the captured + interview fields.

**Ownership sentinel**: if a root `./HANDOFF.md` already exists and does NOT contain the `Doc format v1` marker, it is a foreign file — do NOT overwrite it; write to `.handoff/HANDOFF.md` instead (which is the default here anyway).

### B5. Print the output — abs-path-first, in this order

1. The absolute path of `.handoff/HANDOFF.md` as plain text.
2. A clickable markdown link to it.
3. The absolute path of `.handoff/handoff.diff`.
4. The fenced paste-prompt (see below).
5. The per-tool "find your source session" tips.

---

## Canonical handoff document template (INLINED — single source of truth)

Render these sections **in this exact order**, ending with the `Doc format v1` footer marker. Square-bracket placeholders are filled from the captured git state + interview. This mirrors specweave's `handoff-doc-format.ts` so a doc produced here is byte-compatible with one produced by the CLI.

```markdown
# Work Handoff[: <title if known>]

- Doc path: <ABSOLUTE_DOC_PATH>
- Doc link: [<ABSOLUTE_DOC_PATH>](<ABSOLUTE_DOC_PATH>)
- Diff file: <ABSOLUTE_DIFF_PATH>
- Generated: <ISO_TIMESTAMP>
- Workspace: <ROOT> (non-SpecWeave)
- Git: branch `<BRANCH>` @ `<SHA>`

## Where I Left Off

**Why handing off:** <reason>
**Summary:** <summary>
_No active SpecWeave increment — this is a git + interview handoff._

## Done / Pending

_No increment task/AC state available._

## Key Decisions & Gotchas

- <decision 1>
- <decision 2>

**Gotcha:** <gotcha>

## Files Touched

**UNCOMMITTED** — commit, stash, or keep editing BEFORE doing anything destructive.

```
<git status --porcelain>
```

```
<git diff --stat>
```

Full uncommitted diff: `<ABSOLUTE_DIFF_PATH>` — read it or run `git apply --check` against it to see the exact edits.

## Exact Next Steps

<next>

## How To Resume

If the doc path above does NOT exist on the machine you are reading this on, STOP and ask the user to paste the handoff — do not improvise context.

To recover the ORIGINAL transcript (optional), find your source session per tool:

### Claude Code
- Find session: ls ~/.claude/projects/<munged-cwd>/ (munge: every non-alphanumeric char → "-", runs NOT collapsed; e.g. /Users/antonabyzov/Projects/github/specweave-umb/.claude-worktrees/x → -Users-antonabyzov-Projects-github-specweave-umb--claude-worktrees-x)
- Resume: `claude -r <uuid>`

### Codex
- Find session: ls ~/.codex/sessions/ (newest dir = most recent session)
- Resume: `codex resume <uuid>   (or: codex resume --last)`

### OpenCode
- Find session: opencode sessions list
- Resume: `opencode -s <id>   (long form: opencode --session <id>)`

### Gemini CLI
- Find session: run /chat list inside the Gemini session to see saved tags
- Resume: `/chat resume <tag>`

### Antigravity
- Find session: open the Antigravity Agent Manager and pick the prior task thread
- Resume: `resume the thread from the Antigravity Agent Manager`

### Aider
- Find session: aider keeps .aider.chat.history.md in the repo root
- Resume: `aider --restore-chat-history`

## Redaction

- <N> `<type>` strings masked

_Scrubbing is heuristic (regex baseline). An empty redaction list is NOT a guarantee this file is clean — review before sharing or committing._

---
<!-- Doc format v1 -->
```

Notes on the template:
- If there are **no uncommitted changes**, replace the Files Touched body with `_Working tree clean — no uncommitted edits._` (or `_Not a git repository — no diff captured._` when there is no git).
- If there are **no decisions**, the Key Decisions body is `_No decisions recorded._`; omit the **Gotcha:** line when no gotcha was given.
- The Redaction body is `_No token-like strings were detected._` when nothing was masked.
- The footer marker `<!-- Doc format v1 -->` is mandatory and must be the last line — it is the ownership sentinel.

---

## Paste-prompt

**Default (file reachable):**

```
Resume my work. Read the handoff doc at: <ABSOLUTE_DOC_PATH>
If that path does NOT exist on this machine, STOP and ask me to paste the handoff — do not improvise context.
The exact uncommitted edits are in: <ABSOLUTE_DIFF_PATH>
```

**`--inline` (cross-machine, file unreachable):** embed the FULL doc body between markers so it travels in the prompt itself:

```
Resume my work using the self-contained handoff below.
This is a full handoff doc — treat everything between the markers as ground truth. If it references a `.diff` path that does not exist on this machine, ask me to paste the diff.

BEGIN HANDOFF
<full rendered handoff document, including the Doc format v1 footer>
END HANDOFF
```

---

## Safety defaults

- The doc + diff are **gitignored by default** (`.handoff/.gitignore` = `*`) and **never auto-committed**. Do not print a `git add` hint.
- Secret scrubbing runs over both free text and the diff **before** any write.
- Scrubbing is heuristic — advise the user to review before sharing or committing.
