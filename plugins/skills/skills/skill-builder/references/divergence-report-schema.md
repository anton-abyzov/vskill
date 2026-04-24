# Divergence report schema

Every skill emitted by `skill-builder` carries a companion report that
documents what changed when the same canonical skill was lowered for
each target agent. Downstream tooling (CI gates, Studio preview) reads
this file to surface "this skill loses X on target Y" without having to
diff the emitted files.

## File name convention

- Sibling of the skill root.
- Lowercase skill id, suffix `-divergence.md`.
- Example: for skill `lint-markdown`, the report is `lint-markdown-divergence.md`.

## Shape

One `##` section per target agent, in stable order (same order as
`src/agents/agents-registry.ts`). Each section lists frontmatter
fields that were dropped entirely or translated to a target-specific
equivalent.

```markdown
# lint-markdown — divergence report

## claude-code
- No changes. All frontmatter preserved.

## cursor
- Dropped: allowed-tools (Cursor does not enforce tool allowlists)
- Dropped: model (Cursor binds model at the host level)

## opencode
- Translated: allowed-tools: [Bash] → OpenCode permission: { bash: ask }
- Dropped: context: fork (OpenCode has no fork semantics)
```

## Security-critical fields

If ANY of the following frontmatter fields are dropped or translated
for ANY target, they MUST appear in the report for that target — even
if the rest of the section would otherwise read "No changes":

- `allowed-tools` — security boundary. Dropping it widens the tool
  surface for that target.
- `context: fork` — execution isolation. Dropping it means the skill
  runs in the host agent's main context, not a fork.
- `model` — pinned model identity. Dropping it lets the host choose,
  which may differ from what the author tested against.

## Example entry — translated security field

```markdown
## opencode
- Translated: allowed-tools: [Bash] → OpenCode permission: { bash: ask }
```

The `→` form is the canonical translation marker. Left side is the
canonical Claude-style frontmatter; right side is the target's
equivalent.

## Edge case — no divergences

When every target accepts the canonical frontmatter verbatim (e.g. the
skill has no `allowed-tools`, `context`, or `model` fields to begin
with), the file still exists but contains a single line:

```markdown
No divergences — all targets universal
```

This line is the exact sentinel downstream tooling greps for; do not
reword it.
