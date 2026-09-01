---
name: excalidraw-mcp
description: Build Excalidraw diagrams through the official Excalidraw MCP and turn the same source into a real .excalidraw file on disk or an Obsidian .excalidraw.md drawing. Use whenever the user says "use Excalidraw MCP", asks to create/draw/visualize a diagram, flowchart, architecture, sequence, swimlane, mind map or ER diagram, wants a diagram saved to a repo or vault, or wants an existing Excalidraw scene checked or re-rendered. Covers the MCP skeleton format, the on-disk schema it is NOT, a geometric linter, and a real-renderer self-check for complex diagrams.
version: 1.1.1
license: MIT
repository: anton-abyzov/vskill
mcp-deps: [excalidraw]
allowed-tools: Bash, Read, Write, Edit, mcp__excalidraw__read_me, mcp__excalidraw__create_view, mcp__excalidraw__export_to_excalidraw, mcp__excalidraw__save_checkpoint, mcp__excalidraw__read_checkpoint
---

# Excalidraw via MCP

Saying "use Excalidraw MCP" should be enough to get a complicated diagram, drawn live
and saved where it belongs. This skill is what makes that true.

## The one thing that breaks everything

`create_view`'s element format is a **skeleton**, not the on-disk schema. A shape's
`label` is skeleton-only sugar. Excalidraw's canvas renderer has **no text branch for
rectangle / ellipse / diamond** — container text is drawn only via
`boundElements → containerId`. So pasting `create_view` JSON into a `.excalidraw` file
produces **empty boxes**, silently. That single fact is why `scripts/excalidraw_build.py`
exists: author once in the skeleton, get both the live render and a correct file.

Second fact: hand-authored diagrams do not degrade gradually with size — they fail on
**irregularity**. Measured on a real generated scene, elements produced by a repeating
layout formula had a 0.00 defect rate; bespoke one-off elements had 0.71. So compute
positions with a formula, and let the linter check the result.

## Setup on a new machine

Installing this skill does **not** install the MCP server — `mcp-deps` is a declaration
that `vskill check` verifies, not an installer. Add the server once per machine:

```bash
claude mcp add --transport http --scope user excalidraw https://mcp.excalidraw.com
```

`--scope user` registers it for every project on that machine (written to
`~/.claude.json`). Drop the flag for the current project only, or use
`--scope project` to commit it to the repo's `.mcp.json` so teammates get it on clone.
Verify with `claude mcp list`, or `vskill check excalidraw-mcp`.

Without the MCP the skill still works for everything except the live inline render:
`excalidraw_build.py` and `excalidraw_lint.py` are plain Python 3 with no dependencies
and no network, so files and validation keep working. `excalidraw_render.py` additionally
wants `pip install playwright && playwright install chromium`.

## Workflow

1. **Author the skeleton.** One JSON array, the same one `create_view` takes. Positions
   come from a layout formula (see `references/layout-recipes.md`), never from eyeballing.
2. **Lint it** — offline, no dependencies, catches overflow/collision/geometry:
   ```bash
   python3 scripts/excalidraw_lint.py scene.json --camera
   ```
   `--camera` prints a correctly framed 4:3 `cameraUpdate` to paste at the top.
3. **Render it live** with `mcp__excalidraw__create_view`, elements streamed in
   z-order with camera moves (see `references/mcp-workflow.md`). Keep the returned
   `checkpointId`.
4. **Save the file** when the user wants one on disk:
   ```bash
   python3 scripts/excalidraw_build.py scene.json -o out.excalidraw
   python3 scripts/excalidraw_build.py scene.json -o out --obsidian   # → out.excalidraw.md
   python3 scripts/excalidraw_build.py scene.json -o out.excalidraw --dark
   ```
5. **Look at it** before declaring success on anything non-trivial. This renders through
   Excalidraw's own `exportToSvg`, so text is measured with real font metrics:
   ```bash
   python3 scripts/excalidraw_render.py out.excalidraw -o /tmp/preview.png
   ```
   Then Read the PNG. Fix what you see; re-lint; re-render.

Steps 2 and 5 are the quality gate. Skipping them is how labels end up outside their
boxes and arrows end up pointing at nothing.

## Skeleton cheat sheet

```jsonc
{"type":"rectangle","id":"api","x":100,"y":80,"width":180,"height":80,
 "roundness":{"type":3},"backgroundColor":"#a5d8ff","fillStyle":"solid",
 "strokeColor":"#4a9eed","label":{"text":"API Gateway","fontSize":18}}

{"type":"arrow","id":"e1","from":"api","to":"db","label":{"text":"SQL"}}   // auto-bound
{"type":"arrow","id":"e2","from":"api","to":"db","route":"ortho"}          // L-shaped
{"type":"arrow","id":"e3","x":300,"y":150,"points":[[0,0],[120,0]]}        // manual

{"type":"text","id":"ttl","center":400,"y":20,"text":"Title","fontSize":24} // auto-centred
{"type":"rectangle","id":"zone","x":40,"y":40,"width":700,"height":420,
 "opacity":30,"zoneLabel":"Data layer"}                                     // caption, not bound label
```

Builder-only extensions: `from`/`to` (perimeter anchors + two-way binding),
`route:"ortho"`, `zoneLabel`, `center` on text, `fixedWidth` on a shape (wrap instead
of grow). Everything else is passed through unchanged, so the same array still works
verbatim with `create_view`.

**Never** put a bound `label` on a background zone rectangle — it centres in the middle
of the zone and cannot be grabbed. Use `zoneLabel`.

## Choosing the output

| Destination | Command | Notes |
|---|---|---|
| Show the user now | `create_view` | animated, camera-guided; returns `checkpointId` |
| File in a repo | `excalidraw_build.py -o x.excalidraw` | opens at excalidraw.com or in the VS Code extension |
| Obsidian vault | `... -o x --obsidian` | `.excalidraw.md`, plugin-parsed, git-diffable |
| Shareable link | `mcp__excalidraw__export_to_excalidraw` | **uploads to excalidraw.com — ask first** |

The MCP has no local-file tool. `export_to_excalidraw` is a public upload, so treat it
as publishing: confirm with the user before calling it.

## Iterating

`create_view` returns a `checkpointId`. To continue from it — including user edits made
in fullscreen — start the next array with
`{"type":"restoreCheckpoint","id":"<checkpointId>"}` and append only what is new. Use
`{"type":"delete","ids":"a,b"}` to remove elements; never reuse a deleted id. Keep the
skeleton file on disk in sync, since that file is what builds and lints.

## References

- `references/file-format.md` — the on-disk schema, verified against upstream: font
  codes, bound text, arrow geometry, bindings, what Excalidraw does and does not
  recompute on open. Read before hand-editing any `.excalidraw` file.
- `references/mcp-workflow.md` — camera choreography, streaming order, checkpoints,
  dark mode, and the MCP's own limits.
- `references/layout-recipes.md` — formulas for flow, layered, swimlane, sequence, grid,
  radial and matrix layouts, plus how to keep a 60-element diagram legible.
- `references/obsidian.md` — the `.excalidraw.md` wrapper, block-ref rules, and the
  compressed-scene gotcha.
- `scripts/split_excalidraw_library.py` — split an `.excalidrawlib` (AWS/GCP/K8s icon
  packs from libraries.excalidraw.com) into per-icon JSON plus a lookup table, so icon
  data never enters context.

## Limits worth stating out loud

- Width estimates are calibrated per-character, not measured from the font binary; the
  linter warns inside 10% of overflow. When it warns on something important, render it.
- `excalidraw_render.py` needs `playwright` plus network access to esm.sh. Without them,
  lint is still fully offline.
- The linter cannot judge whether a diagram is *good*, only whether it is *correct*.
  Composition is still your job.

## Changelog

- **1.1.1** — linter no longer applies the box-fit rules (R1/R2) to arrow
  containers; arrow labels are laid along the path and are covered by R10.
- **1.1.0** — moved into the vskill monorepo at `skills/excalidraw-mcp/`, matching
  `remotion-best-practices` and the other in-repo skills. The standalone
  `anton-abyzov/excalidraw-mcp-skill` repo is deprecated.
- **1.0.1** — document MCP setup: installing the skill does not install the server;
  added the `claude mcp add` one-liner and what still works without it.
- **1.0.0** — first release. Replaces the file-only `excalidraw-diagram-generator`
  skill, whose templates emitted inline `text` on shapes and therefore opened as empty
  boxes.
