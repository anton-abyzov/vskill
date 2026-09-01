# The on-disk .excalidraw format

Verified against `excalidraw/excalidraw` master: `packages/element/src/types.ts`,
`packages/common/src/constants.ts`, `packages/common/src/font-metadata.ts`,
`packages/excalidraw/data/restore.ts`, `packages/element/src/textElement.ts`,
`packages/element/src/renderElement.ts`.

## Document envelope

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "https://excalidraw.com",
  "elements": [],
  "appState": { "gridSize": null, "viewBackgroundColor": "#ffffff" },
  "files": {}
}
```

## What is required, what is defaulted

`restoreElementWithProperties` fills in every base field, and `syncInvalidIndices`
regenerates a missing or null `index` from array order. Missing `seed`,
`versionNonce`, `updated` and `index` are therefore **not fatal** — emit them anyway
so files are reproducible and diff cleanly.

Unknown properties **survive** restore: it spreads `...element` deliberately for
forward-compatibility and deletes only two legacy keys (`strokeSharpness`,
`boundElementIds`). That is why an inline `text` on a rectangle persists in the JSON
while never appearing on screen — the property is kept, the renderer just has nowhere
to draw it.

## Fonts

`FONT_FAMILY` (constants.ts):

| code | family | status |
|---|---|---|
| 1 | Virgil | deprecated, still registered and still renders |
| 2 | Helvetica | deprecated, local |
| 3 | Cascadia | deprecated |
| **5** | **Excalifont** | **`DEFAULT_FONT_FAMILY` — use this** |
| 6 | Nunito | |
| 7 | Lilita One | |
| 8 | Comic Shanns | |
| 9 | Liberation Sans | |
| 10 | Assistant | |

There is no code 4. Files using 1/2/3 still render in those fonts; nothing is
silently upgraded.

Per-family default `lineHeight`: 1.25 for Excalifont, Nunito, Comic Shanns, Virgil
and Assistant; 1.2 for Cascadia; 1.15 for Helvetica, Lilita One and Liberation Sans.

**Always write `lineHeight` explicitly.** If it is absent and `height` is present,
restore back-derives `lineHeight = height / lineCount / fontSize` and bakes the
result in. That is how files end up with values like `1.0714285714285714`.

## Text geometry is yours to compute

`refreshDimensions` is never passed as true anywhere in the app, so opening a file
does **not** recompute text `x`/`y`/`width`/`height`. The canvas splits `text` on
`\n` and does no wrapping of its own. The writer must:

- insert its own line breaks in `text` (keep the unwrapped string in `originalText`),
- set `width`/`height` from the wrapped string,
- position the element itself.

## Container (bound) text

Rect / ellipse / diamond / arrow can carry bound text. Required shape:

```jsonc
// container
{"id":"box1","type":"rectangle", "boundElements":[{"type":"text","id":"box1-label"}]}

// the label, as its OWN element
{"id":"box1-label","type":"text","containerId":"box1",
 "textAlign":"center","verticalAlign":"middle","autoResize":true,
 "fontFamily":5,"fontSize":18,"lineHeight":1.25,
 "text":"Two\nlines","originalText":"Two lines",
 "x":..., "y":..., "width":..., "height":...}
```

`BOUND_TEXT_PADDING` is 5 per side. Bound text should sit immediately after its
container in the elements array.

The text↔container link is **self-healing in both directions** on import: either side
alone is repaired, and a `containerId` pointing at a missing element is nulled. Arrow
bindings are **not** repaired the same way, so write reciprocity yourself.

## Arrows

- `points` are **relative to the element's `x`/`y`**, and `points[0]` must be `[0,0]`
  — `x,y` *is* the first point, not the bounding-box corner.
- `width`/`height` are recomputed by `getSizeFromPoints` as the extents of the points
  (`max - min`, never negative). Emit them that way.
- Bound arrow labels are positioned by the renderer along the path, so a multi-point
  arrow can carry a label — but keep it short: if the text is wider than the path it
  will collide with everything nearby.
- Bindings: current master uses `{elementId, fixedPoint, mode}`, but `restore.ts`
  migrates the legacy `{elementId, focus, gap}` form, which is what to emit for
  portability across builds.
- Reciprocity: each bound shape needs `{"type":"arrow","id":"<arrowId>"}` in its
  `boundElements`. Nothing adds this for you.

## Quick self-check

```bash
python3 scripts/excalidraw_lint.py file.excalidraw --camera
```

Rules it enforces: unique ids (R0), label fits its box (R1/R2), arrow bbox matches its
points (R7), `points[0] == [0,0]` (R8), arrow label fits its path (R10), camera framing
and font floors (R11), bindings present (R12), dangling references (R13), inline shape
text (R14), missing reciprocity (R15), deprecated font / missing lineHeight (R16/R17),
readable font sizes (R18), text metrics (R19), shape overlap (R20), text collisions (R21).
