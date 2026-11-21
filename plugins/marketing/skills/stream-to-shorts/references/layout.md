# Layout

Layout of a 1080x1920 short cut from a stream: where the face, the screen and the text go, how the screen window is chosen, and the rejects to check for.

Basis tags: [M] measured on reference shorts (a November 2026 sample of 15 outlier shorts: 7 talking AI-coding clips and 8 gaming clips), [V] vendor or practitioner claim, [C] our choice. The geometry tables below are [C]: what the run's cutter rendered, and the defaults in `scripts/cutplan.py`. [M] the reference stream clips stack the facecam on top of the screen or game.

## Safe zones limit text only

1. The text-safe box on 1080x1920 is x 65 to 888, y 288 to 1248, 823 x 960 px. It is the union of the YouTube, Meta and TikTok figures; `platform-specs.md` carries the sources and dates. [V]
2. Captions, the title bar and labels stay inside the box. Platform buttons, the caption sheet and the progress bar cover the rest. [V]
3. Picture fills the whole frame, including the top 288 px and the bottom 672 px. Those strips are dead for text, never for picture. [C], from the empty-bottom reject below.
4. Centre text on x 476, the centre of the safe box, not on x 540. The right rail is wider than the left margin. [V]

## Stack layout (default)

Use it when the stream has a facecam and the screen or game carries the moment.

| Band | y range | What fills it |
|---|---|---|
| Face panel | 0 to 640 | the stream's facecam box, cropped eyes to collar, scaled to the full 1080 width |
| Title bar | 640 to 760 | white bar, black title text |
| Screen or game | 760 to 1920 | a window of the source, cover-cropped to 1080x1160, edge to edge |

| Text | Position |
|---|---|
| Word captions | centred at y 555, over the lower part of the face panel |
| Title text | centred in the bar, at y 700 |
| Labels | centred at y 850, at the top of the screen panel; never below y 1200 |

5. Captions sit over the face, not over the screen, so they never cover the action. [C]
6. Mark the facecam box once per stream layout, from a frame of the source. Crop it from eyes to collar so the face fills the 1080x640 panel. A small facecam scaled more than 2x gets a light sharpen. [C]

   If the stream layout changes partway (the facecam moves, shrinks or hides), mark the box again for those segments with the segment's `face` field. A segment with no facecam goes to the full layout.

7. The screen window is cover-cropped: it keeps the 1080:1160 aspect and fills the panel. Never letterbox it, never pad it, never put blurred or black fill under it. [C]

## Full layout

Use it when there is no facecam for the moment, or the picture is the whole show (a render, a fail screen).

| Element | Position |
|---|---|
| Picture | one 9:16 crop of the source fills 1080x1920 |
| Title bar | starts at y 288, the top of the safe box |
| Word captions | centred at y 1120 |
| Labels | centred at y 520 |

8. The 9:16 window is at least 960 source pixels tall on a 1080p source, so a full-layout crop is never zoomed past 2x. [C]
9. Do not borrow a face from another time to fill a stack layout. Use the full layout instead. [C]

## Choosing the screen window

10. The window is chosen by eye, per segment, from a contact sheet of the source made with `scripts/sheet.py`. Nothing tracks the action automatically. [C]
11. Write it in the cut spec as `"win": [x, y, w, h]` in source pixels, around the action: the active window, the cursor and what it acts on, the car, the result. The cutter centres the panel on it and widens it to the panel's aspect. [C]
12. Choose a new window for each segment so the picture follows the action. A screen share has several regions; the one that matters moves. [C]
13. Never centre-crop a screen share. The middle of a desktop is rarely where the action is. [C]
14. Zoom cap: the screen window is never smaller than half the panel height in source pixels (580 px of a 1080p source for the 1160 px panel), which is 2x. Past that, UI text is replaced by a caption or a label, not zoomed further. [V] platforms demote low-resolution reels; [C] the 2x figure.
15. Read the source's best format before mining (`yt-dlp -F` for a hosted stream). A 1080p source leaves twice the zoom room of a 720p one. [C]
16. UI text that matters must be about 40 px tall or more after scaling. If the zoom cap stops short of that, a caption or a label carries the words. [C]
17. A punch-in narrows the window by the punch factor. At the zoom cap there is no room left and the punch does nothing (see `edit-rules.md`). [C]

Example, made up. A 1920x1080 screen share has the editor on the left half and a chat panel on the right. The segment gets `"win": [0, 120, 960, 840]`. The cutter keeps the 840 px height, narrows the window to the panel's aspect (782 x 840 at x 88, y 120), and scales it 1.38x into the 1080x1160 panel. The punched-in shot after it uses about 724 x 776 px of the same area. A window of `[700, 400, 300, 200]` would ask for more than 2x; the cutter widens it to 580 px tall instead, so a line of small UI text inside it needs a caption.

## Named rejects

Each reject has a check. A clip that hits one is re-rendered before anything is scheduled.

| Reject | What it looks like | Check |
|---|---|---|
| Empty bottom | the screen panel letterboxed, with blurred or black fill under it, so the bottom third of every frame is empty | `python3 scripts/fill_check.py <master>` (exit 1 on fail), plus the contact sheet |
| Text wall at frame 0 | more than 7 readable words in the first frame, counting the title bar, labels, captions and UI text | read frame 0 on the contact sheet and count |
| Letterbox or border | bars or a frame around the picture, in any layout | contact sheet; `fill_check.py` catches the bottom case. [V] platforms demote reels with borders |
| Centre crop of a screen share | the panel shows the middle of the desktop and loses the active window | compare each segment's `win` against the source contact sheet |
| Text outside the safe box | a caption, title or label crosses x 65 to 888 or y 288 to 1248 | contact sheet with the safe box drawn over it; long words in a caption group are the usual cause |
| Unreadable UI | UI text under about 40 px tall after scaling, with no caption or label carrying it | look at the frame at phone size |
| Borrowed face | a face shot from another time that is not a reaction to the same event | check the source time of each face shot in `shots.json` |

18. The empty-bottom reject happened. The first render of the run letterboxed the screen panel and left the bottom third of every frame empty, with blurred or black fill under it. Every clip was re-rendered before anything was posted. The cause was wording: an instruction to treat the bottom 672 px as dead and to keep faces and the key screen region inside the safe box. That wording is replaced by rule 3. [C]
19. `fill_check.py` is a heuristic. A pass is a hint, not proof; the contact sheet is still read by eye. [C]

20. Make one contact sheet per master with `scripts/sheet.py`, at its default opening times (0, 0.5, 1, 2, 3 s) plus a few frames across the rest of the clip. The rejects above are read from it. [C]
21. On the same sheet, the face panel shows a face in every frame, not a shoulder, a hand or an empty chair. If the person leaves the facecam, switch that segment to the full layout. [C]
