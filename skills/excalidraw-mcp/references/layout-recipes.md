# Layout recipes

The model authors a **semantic graph** — nodes, edges, lanes, labels. A formula
computes every coordinate. That split is the whole reason complex diagrams come out
clean: in a measured scene, formula-produced elements had a 0.00 defect rate against
0.71 for hand-placed ones.

Write the formula in a throwaway Python script that prints the skeleton array, then
lint and build that array. Do not type 60 coordinates by hand.

## Sizing from text

```python
W = max(120, ceil(est_width(label, F)) + 22)     # 22 = 2*(BOUND_TEXT_PADDING + safety)
H = max(60,  ceil(len(lines) * F * 1.25) + 10)
```

`excalidraw_build.py` already grows a box that is too small for its label, so it is
safe to pass a nominal size — but a row of boxes looks better when they share one
width, so compute `W = max(...)` across the row and use it for all of them.

## Left-to-right flow

```python
GAP = 40
x = X0
for i, node in enumerate(nodes):
    emit_box(node, x=x, y=Y, width=W, height=H)
    if i: emit_arrow(f"e{i}", frm=nodes[i-1].id, to=node.id)
    x += W + GAP
```

Detail boxes under a step: same `x`, `y + H + 60`, with a dashed arrow `from` step
`to` detail. Keep the vertical gap ≥ 60 so the arrowhead is not swallowed.

## Layered / architecture

Rows are layers, columns are components. Draw the zone rectangle first with
`opacity: 30` and a `zoneLabel`, then the components inside it.

```python
for r, layer in enumerate(layers):
    zy = Y0 + r * (H + V_GAP + 40)
    emit_zone(layer.name, x=X0-20, y=zy-30, width=total_w+40, height=H+50)
    for c, comp in enumerate(layer.items):
        emit_box(comp, x=X0 + c*(W+GAP), y=zy, width=W, height=H)
```

Zone captions live at `(zone.x + 12, zone.y + 8)`. Never bind a label to a zone.

## Swimlanes

One column per actor, one row per step. Lane dividers are lines, not boxes.

```python
LANE_W, ROW_H = 220, 110
lane_x  = lambda i: X0 + i * LANE_W
row_y   = lambda j: Y0 + j * ROW_H
# actor headers at row_y(-1); box centred in its lane:
box_x   = lambda i: lane_x(i) + (LANE_W - W) / 2
```

A cross-lane handoff is an arrow `from` the source box `to` the target box; use
`route: "ortho"` when the two are more than one lane apart, so the line does not cut
diagonally through an intervening box.

## Sequence diagram

```python
col_x  = lambda i: X0 + i * COL_W          # COL_W >= 170
msg_y  = lambda k: Y0 + HEAD_H + 40 + k*40
```

Lifelines are dashed arrows with `endArrowhead: null` from the header box down past
the last message. Messages are horizontal arrows between two lifeline x positions.

Two rules that matter: a right-to-left message still needs `points[0] == [0,0]` with a
negative second point (the builder normalises this for you), and a message label must
be shorter than the gap between lifelines or it will straddle the neighbouring
lifeline. `COL_W = 170` fits about 20 characters at `fontSize: 16`.

## Grid

```python
cols = ceil(sqrt(n))
x = X0 + (i % cols) * (W + GAP)
y = Y0 + (i // cols) * (H + V_GAP)
```

## Radial / mind map

```python
for i in range(n):
    a = 2*pi*i/n - pi/2                       # start at 12 o'clock
    x = cx + R*cos(a) - W/2
    y = cy + R*sin(a) - H/2
```

`R ≥ (W + 40) * n / (2*pi)` keeps neighbours from touching. Beyond ~8 branches, use
two rings at different radii instead of one crowded circle.

## Matrix / dependency table

Row and column headers as text, cells as small rectangles. Colour carries the value;
do not put long text in a cell — put a legend beside the matrix.

## Keeping a big diagram legible

- **Cap what is on one canvas.** Past ~40 shapes, split by subsystem and draw an index
  diagram that links to the parts. `1600×1200` at `fontSize: 21` is the practical
  ceiling for one view.
- **Group with zones, not with proximity.** A tinted zone rectangle at `opacity: 30`
  does more for comprehension than tighter spacing.
- **One arrow style per meaning.** e.g. solid = control flow, dashed = data, colour =
  subsystem. State the convention in a small legend box.
- **Keep arrow labels ≤ 12 characters.** The linter fails a label wider than its path.
- **Route around obstacles.** `route: "ortho"` for L-shapes; for anything hairier give
  explicit `points` and check the render.
- **Re-lint after every structural edit**, then render and actually look at it.
