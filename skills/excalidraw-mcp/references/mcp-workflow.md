# Driving the Excalidraw MCP

The server at `https://mcp.excalidraw.com` is the official Excalidraw MCP
(`github.com/excalidraw/excalidraw-mcp`, MIT). It exposes exactly five tools:

| tool | what it does |
|---|---|
| `read_me` | element-format reference. Call once per conversation, never twice. |
| `create_view` | streams elements into an inline canvas with draw-on animation; returns a `checkpointId` |
| `read_checkpoint` | reload a saved scene, including edits the user made in fullscreen |
| `save_checkpoint` | persist edited state |
| `export_to_excalidraw` | **uploads to excalidraw.com** and returns a public URL |

**No tool writes a file the user can open locally.** The hosted deployment keeps
checkpoints server-side (Redis/memory); a locally-run stdio build keeps them in
`os.tmpdir()`. Neither is a deliverable. For a file, use `scripts/excalidraw_build.py`.
Treat `export_to_excalidraw` as publishing: ask before calling it.

## Streaming order

Array order is z-order **and** draw order. Emit progressively so the diagram builds
the way a person would draw it:

```
cameraUpdate → zone rect → zone caption → shape → its label → its arrows → next shape
```

Not: all rectangles, then all text, then all arrows. That renders as three
disconnected waves and reads badly.

## Camera choreography

`cameraUpdate` is a pseudo-element (no `id`, never drawn). It must be 4:3:
400×300, 600×450, 800×600, 1200×900, or 1600×1200. `x`/`y` are the top-left of the
visible area in scene coordinates.

Minimum readable font per camera width: 400→14, 600/800→16, 1200→18, 1600→21.
`excalidraw_lint.py --camera` computes a correctly padded camera for the scene and
warns when the smallest text is below the floor for it.

A good sequence for anything non-trivial:

1. `600×450` on the title area — draw title and subtitle.
2. `800×600` — zoom out, draw the main flow.
3. one `600×450` per section as you draw that section's detail.
4. final `800×600`/`1200×900` — settle on the whole diagram.

Never match the camera to the content bounds exactly; leave 40px+ of padding or the
edges clip.

## Checkpoints

Every `create_view` returns a `checkpointId`. To extend a scene without resending it:

```jsonc
[{"type":"restoreCheckpoint","id":"<checkpointId>"},
 {"type":"delete","ids":"old1,old2"},
 { ...new elements... }]
```

Deleting a container also removes its bound text. Never reuse a deleted id. Keep the
skeleton JSON on disk in step with the checkpoint — the file is what builds and lints.

## Animation

Delete-and-replace at the same coordinates, with small camera nudges between frames,
gives a transformation effect during streaming. Useful for showing state changes; use
new ids for every replacement element.

## Dark mode

Put a huge background rectangle first, before the camera, so it covers the viewport
under any pan:

```json
{"type":"rectangle","id":"bg","x":-4000,"y":-3000,"width":10000,"height":7500,
 "backgroundColor":"#1e1e2e","fillStyle":"solid","strokeColor":"transparent","strokeWidth":0}
```

Then: text `#e5e5e5` primary / `#a0a0a0` muted; fills `#1e3a5f` blue, `#1a4d2e` green,
`#2d1b69` purple, `#5c3d1a` orange, `#5c1a1a` red, `#1a4d4d` teal; keep the bright
primary colours for strokes and arrows. For the file version pass `--dark` to the
builder, which sets the canvas background and light default text instead.

## House palette

Fills: `#a5d8ff` blue (input/primary) · `#b2f2bb` green (success/output) ·
`#ffd8a8` orange (external/pending) · `#d0bfff` purple (processing) ·
`#ffc9c9` red (error) · `#fff3bf` yellow (decision/notes) · `#c3fae8` teal (storage) ·
`#eebefa` pink (metrics).
Strokes: `#4a9eed` · `#22c55e` · `#f59e0b` · `#8b5cf6` · `#ef4444` · `#06b6d4`.
Zones at `opacity: 30`: `#dbe4ff` UI · `#e5dbff` logic · `#d3f9d8` data.

Text contrast on white: never lighter than `#757575`. Coloured text needs the dark
variant (`#15803d`, not `#22c55e`).

No emoji in Excalidraw text — the font does not render them.
