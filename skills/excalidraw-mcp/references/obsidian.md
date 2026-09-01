# Obsidian Excalidraw drawings

The Obsidian Excalidraw plugin (zsviczian) stores drawings as **markdown**, not as
`.excalidraw` JSON. Write `<name>.excalidraw.md`:

```
---

excalidraw-plugin: parsed
tags: [excalidraw]

---
==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠==


# Excalidraw Data

## Text Elements
First label ^text-id-1

Second label ^text-id-2

%%
## Drawing
```json
{"type":"excalidraw","version":2,"source":"https://github.com/zsviczian/obsidian-excalidraw-plugin","elements":[...],"appState":{...},"files":{}}
```
%%
```

`scripts/excalidraw_build.py --obsidian` emits exactly this.

## Rules that bite

- **Every `^ref` must equal the `id` of its text element** in the JSON, or block links
  break. Obsidian block references accept only `[A-Za-z0-9-]`, so ids containing `_`
  or `.` must be sanitised — the builder rewrites them and remaps every reference.
- **Blank line between each Text Elements entry.** Multi-line labels span lines with
  the `^ref` on the last one.
- **The trailing `%%` after the closing fence is mandatory.** The opening `%%` goes
  immediately before `## Drawing`.
- **Omit `# Excalidraw Data` and `## Text Elements` entirely** for a drawing with no
  text elements.
- Filename must end `.excalidraw.md` (the plugin's `useExcalidrawExtension` default).

## Compressed scenes

Vaults with `compress: true` — which is the default, and the setting on all of Anton's
three vaults — save the scene as LZ-String base64 in a ` ```compressed-json ` fence.
The plugin **reads plain ```json too**, so always write uncompressed: it stays
diffable in git, and the plugin re-compresses on the first save from the UI.

To read an existing compressed drawing, run Obsidian's command-palette action
*"Decompress current Excalidraw file"* first; `excalidraw_lint.py` refuses a compressed
scene with that instruction rather than guessing.

## Where drawings live

`Excalidraw/` at the vault root is the plugin's default folder, and existing drawings
in these vaults are there. Put a diagram next to the note it illustrates only if the
user asks; otherwise follow the vault's PARA placement for the topic and embed it with
`![[name.excalidraw.md]]`.
