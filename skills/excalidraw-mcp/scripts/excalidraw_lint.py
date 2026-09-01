#!/usr/bin/env python3
"""Geometric linter for Excalidraw scenes. Run it before you ship a diagram.

Hand-authored diagrams do not fail gradually with element count — they fail on
irregularity. In a measured sample, elements produced by a repeating layout
formula had a 0.00 defect rate while bespoke one-off elements had 0.71. These
checks catch that class of defect mechanically.

Accepts a .excalidraw file, an Obsidian .excalidraw.md file, or a raw MCP
skeleton array (pseudo elements are ignored; skeleton labels are checked against
their container box).

    python3 excalidraw_lint.py diagram.excalidraw
    python3 excalidraw_lint.py skeleton.json --skeleton
    python3 excalidraw_lint.py diagram.excalidraw --camera   # suggest a 4:3 view

Exit code 1 if any ERROR fires, 0 otherwise (warnings never fail the run).
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from excalidraw_build import (  # noqa: E402
    BOUND_TEXT_PADDING, CONTAINER_TYPES, LINE_HEIGHT, PSEUDO,
    path_length, text_height, text_width,
)

# Width estimates are calibrated, not measured from the font binary; treat a
# label that lands within this fraction of its limit as a warning, not a pass.
WARN_BAND = 0.90
MIN_BODY_FONT = 16
MIN_TITLE_FONT = 20
CAMERA_SIZES = [(400, 300), (600, 450), (800, 600), (1200, 900), (1600, 1200)]
# read_me's own rule: bigger camera, bigger minimum readable font
CAMERA_MIN_FONT = {400: 14, 600: 16, 800: 16, 1200: 18, 1600: 21}


class Report:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warns: list[str] = []
        self.notes: list[str] = []

    def err(self, rule: str, msg: str) -> None:
        self.errors.append(f"{rule}: {msg}")

    def warn(self, rule: str, msg: str) -> None:
        self.warns.append(f"{rule}: {msg}")

    def note(self, msg: str) -> None:
        self.notes.append(msg)


def load(path: Path) -> tuple[list[dict], bool]:
    """Return (elements, is_skeleton)."""
    text = path.read_text()
    if path.name.endswith(".excalidraw.md") or text.lstrip().startswith("---"):
        m = re.search(r"##? Drawing\n```(?:json|compressed-json)\n([\s\S]*?)```", text)
        if not m:
            raise SystemExit("no ## Drawing fence found in markdown file")
        body = m.group(1)
        if "compressed-json" in text:
            raise SystemExit(
                "scene is LZ-String compressed; run Obsidian's "
                "'Decompress current Excalidraw file' command first"
            )
        return json.loads(body)["elements"], False
    data = json.loads(text)
    if isinstance(data, list):
        return data, True
    return data["elements"], False


def bbox(el: dict) -> tuple[float, float, float, float]:
    x, y = float(el.get("x", 0)), float(el.get("y", 0))
    if el["type"] in ("arrow", "line") and el.get("points"):
        xs = [x + p[0] for p in el["points"]]
        ys = [y + p[1] for p in el["points"]]
        return min(xs), min(ys), max(xs), max(ys)
    return x, y, x + el.get("width", 0), y + el.get("height", 0)


def overlap_area(a: dict, b: dict) -> float:
    ax1, ay1, ax2, ay2 = bbox(a)
    bx1, by1, bx2, by2 = bbox(b)
    w = min(ax2, bx2) - max(ax1, bx1)
    h = min(ay2, by2) - max(ay1, by1)
    return w * h if w > 0 and h > 0 else 0.0


def contains(outer: dict, inner: dict) -> bool:
    ox1, oy1, ox2, oy2 = bbox(outer)
    ix1, iy1, ix2, iy2 = bbox(inner)
    return ox1 <= ix1 and oy1 <= iy1 and ox2 >= ix2 and oy2 >= iy2


def check(elements: list[dict], skeleton: bool, want_camera: bool) -> Report:
    r = Report()
    live = [e for e in elements if e.get("type") not in PSEUDO and not e.get("isDeleted")]
    by_id = {}
    for e in live:
        if "id" in e:
            if e["id"] in by_id:
                r.err("R0-UNIQUE-ID", f"duplicate id {e['id']!r}")
            by_id[e["id"]] = e

    shapes = [e for e in live if e["type"] in CONTAINER_TYPES]
    texts = [e for e in live if e["type"] == "text"]
    arrows = [e for e in live if e["type"] == "arrow"]

    # --- R1/R2/R3 container label fit -------------------------------------
    def check_label(container, label_text, fs):
        pad = 2 * BOUND_TEXT_PADDING
        w = text_width(label_text, fs)
        h = text_height(label_text, fs, LINE_HEIGHT.get(5, 1.25))
        avail_w = container.get("width", 0) - pad
        avail_h = container.get("height", 0) - pad
        cid = container.get("id")
        if w > avail_w:
            r.err("R1-LABEL-WIDTH",
                  f"{cid}: label {label_text.splitlines()[0][:40]!r} ~{w:.0f}px "
                  f"exceeds {avail_w:.0f}px of usable box width")
        elif w > avail_w * WARN_BAND:
            r.warn("R1-LABEL-WIDTH", f"{cid}: label within 10% of overflow ({w:.0f}/{avail_w:.0f}px)")
        if h > avail_h:
            r.err("R2-LABEL-HEIGHT", f"{cid}: label needs {h:.0f}px, box gives {avail_h:.0f}px")

    if skeleton:
        for e in live:
            if e["type"] in CONTAINER_TYPES and e.get("label"):
                lab = e["label"]
                check_label(e, lab["text"] if isinstance(lab, dict) else str(lab),
                            (lab.get("fontSize") if isinstance(lab, dict) else None) or 20)
            if e["type"] in CONTAINER_TYPES and e.get("text"):
                r.err("R14-INLINE-TEXT",
                      f"{e.get('id')}: inline 'text' on a {e['type']} never renders — "
                      f"use 'label' (skeleton) or a bound text element (file)")
        # Everything below needs resolved geometry; the caller lints the built scene.
        return r
    else:
        for t in texts:
            cid = t.get("containerId")
            if not cid:
                continue
            c = by_id.get(cid)
            if not c:
                r.err("R13-DANGLING", f"text {t['id']} points at missing container {cid}")
                continue
            check_label(c, t.get("text", ""), t.get("fontSize", 20))
            bound = c.get("boundElements") or []
            if not any(b.get("id") == t["id"] for b in bound):
                r.err("R15-RECIPROCITY",
                      f"{cid}: missing boundElements entry for its text {t['id']} "
                      f"(container renders empty in older builds)")
        for e in live:
            if e["type"] in CONTAINER_TYPES and e.get("text"):
                r.err("R14-INLINE-TEXT",
                      f"{e['id']}: inline 'text' on a {e['type']} is never rendered by Excalidraw")

    # --- fonts -------------------------------------------------------------
    for t in texts:
        fam = t.get("fontFamily")
        if fam is None:
            r.warn("R16-FONT", f"{t.get('id')}: no fontFamily; set 5 (Excalifont, current default)")
        elif fam in (1, 2, 3):
            r.warn("R16-FONT", f"{t.get('id')}: fontFamily {fam} is deprecated; 5 = Excalifont")
        exp = LINE_HEIGHT.get(fam or 5, 1.25)
        lh = t.get("lineHeight")
        if lh is None:
            r.err("R17-LINEHEIGHT",
                  f"{t.get('id')}: no lineHeight — Excalidraw back-derives it from height "
                  f"and bakes in a garbage value; set {exp}")
        elif abs(lh - exp) > 0.001:
            r.warn("R17-LINEHEIGHT", f"{t.get('id')}: lineHeight {lh} != {exp} for fontFamily {fam}")
        fs = t.get("fontSize", 0)
        floor = MIN_TITLE_FONT if not t.get("containerId") and fs >= MIN_TITLE_FONT else MIN_BODY_FONT
        if fs and fs < MIN_BODY_FONT:
            r.warn("R18-FONTSIZE", f"{t.get('id')}: fontSize {fs} below the {floor}px readable floor")
        if not skeleton and t.get("height"):
            want = text_height(t.get("text", ""), fs, exp)
            if abs(want - t["height"]) > max(2.0, want * 0.15):
                r.warn("R19-TEXT-METRICS",
                       f"{t.get('id')}: height {t['height']:.0f} vs computed {want:.0f} "
                       f"(text geometry is never recomputed on open)")

    # --- arrows ------------------------------------------------------------
    for a in arrows:
        pts = a.get("points") or []
        if len(pts) < 2:
            r.err("R8-ARROW-POINTS", f"{a.get('id')}: arrow needs >= 2 points")
            continue
        if not skeleton:
            if tuple(pts[0]) != (0, 0):
                r.err("R8-ARROW-ORIGIN",
                      f"{a['id']}: points[0] must be [0,0] (x,y IS the first point)")
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            ew, eh = max(xs) - min(xs), max(ys) - min(ys)
            if abs(a.get("width", 0) - ew) > 1 or abs(a.get("height", 0) - eh) > 1:
                r.err("R7-ARROW-BBOX",
                      f"{a['id']}: declared {a.get('width')}x{a.get('height')} but points span "
                      f"{ew:.0f}x{eh:.0f}; a wrong box throws the bound label off the path")
            if not a.get("startBinding") and not a.get("endBinding"):
                r.warn("R12-BINDINGS",
                       f"{a['id']}: no start/end binding — it will not follow its shapes when moved")
            for k in ("startBinding", "endBinding"):
                b = a.get(k)
                if b and b.get("elementId"):
                    tgt = by_id.get(b["elementId"])
                    if not tgt:
                        r.err("R13-DANGLING", f"{a['id']}.{k} -> missing {b['elementId']}")
                    elif not any(x.get("id") == a["id"] for x in (tgt.get("boundElements") or [])):
                        r.err("R15-RECIPROCITY",
                              f"{b['elementId']}: missing boundElements entry for arrow {a['id']} "
                              f"(Excalidraw does not repair arrow reciprocity on import)")
        lab = a.get("label")
        lab_txt = (lab["text"] if isinstance(lab, dict) else lab) if lab else None
        if not lab_txt and not skeleton:
            bt = next((t for t in texts if t.get("containerId") == a.get("id")), None)
            lab_txt, lab = (bt.get("text"), {"fontSize": bt.get("fontSize", 16)}) if bt else (None, None)
        if lab_txt:
            fs = (lab.get("fontSize") if isinstance(lab, dict) else 16) or 16
            plen = path_length(pts)
            lw = text_width(lab_txt, fs)
            if lw > plen - 20:
                r.err("R10-ARROW-LABEL",
                      f"{a.get('id')}: label {lab_txt!r} ~{lw:.0f}px on a {plen:.0f}px path")
            elif lw > 0.7 * plen:
                r.warn("R10-ARROW-LABEL", f"{a.get('id')}: label crowds its {plen:.0f}px path")

    # --- collisions --------------------------------------------------------
    solid = [e for e in shapes if e.get("backgroundColor", "transparent") != "transparent"
             and e.get("opacity", 100) >= 60]
    for i, a in enumerate(solid):
        for b in solid[i + 1:]:
            if contains(a, b) or contains(b, a):
                continue
            ov = overlap_area(a, b)
            if ov > 4:
                small = min(a.get("width", 1) * a.get("height", 1), b.get("width", 1) * b.get("height", 1))
                r.err("R20-OVERLAP",
                      f"{a.get('id')} and {b.get('id')} overlap by {ov:.0f}px2 "
                      f"({ov / small * 100:.0f}% of the smaller shape)")

    free_text = [t for t in texts if not t.get("containerId")]
    for t in free_text:
        for s in solid:
            if overlap_area(t, s) > 4 and not contains(s, t):
                r.warn("R21-TEXT-COLLIDES", f"text {t.get('id')} straddles the edge of {s.get('id')}")
        for a in arrows:
            if overlap_area(t, a) > 4:
                r.warn("R21-TEXT-COLLIDES", f"text {t.get('id')} sits on arrow {a.get('id')}")

    # --- scene framing -----------------------------------------------------
    if live:
        xs1, ys1, xs2, ys2 = zip(*[bbox(e) for e in live])
        x1, y1, x2, y2 = min(xs1), min(ys1), max(xs2), max(ys2)
        w, h = x2 - x1, y2 - y1
        r.note(f"scene bbox: x[{x1:.0f},{x2:.0f}] y[{y1:.0f},{y2:.0f}]  ({w:.0f}x{h:.0f})")
        if want_camera:
            for cw, ch in CAMERA_SIZES:
                if cw >= w + 40 and ch >= h + 40:
                    cx = x1 - (cw - w) / 2
                    cy = y1 - (ch - h) / 2
                    smallest = min((t.get("fontSize", 99) for t in texts), default=99)
                    if smallest < CAMERA_MIN_FONT[cw]:
                        r.warn("R11-CAMERA",
                               f"{cw}x{ch} camera needs fontSize >= {CAMERA_MIN_FONT[cw]}, "
                               f"smallest text is {smallest}")
                    r.note(f'camera: {{"type":"cameraUpdate","width":{cw},"height":{ch},'
                           f'"x":{cx:.0f},"y":{cy:.0f}}}')
                    break
            else:
                r.warn("R11-CAMERA",
                       f"scene is {w:.0f}x{h:.0f}; larger than the 1600x1200 camera — "
                       f"split it or pan across sections")
    return r


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("path")
    ap.add_argument("--skeleton", action="store_true", help="force skeleton mode")
    ap.add_argument("--camera", action="store_true", help="suggest a 4:3 cameraUpdate")
    ap.add_argument("-q", "--quiet", action="store_true", help="errors only")
    args = ap.parse_args()

    elements, detected = load(Path(args.path))
    skeleton = args.skeleton or detected
    if skeleton:
        # A skeleton has no resolved geometry (from/to arrows, centred text), so
        # build it in memory and lint what would actually land on disk.
        from excalidraw_build import Builder
        pre = check(elements, True, False)
        rep = check(Builder(elements).build(), False, args.camera)
        rep.errors = pre.errors + rep.errors
        rep.warns = pre.warns + rep.warns
    else:
        rep = check(elements, False, args.camera)

    for e in rep.errors:
        print(f"ERROR  {e}")
    if not args.quiet:
        for w in rep.warns:
            print(f"warn   {w}")
        for n in rep.notes:
            print(f"       {n}")
    print(f"\n{len(elements)} elements  |  {len(rep.errors)} errors  {len(rep.warns)} warnings")
    return 1 if rep.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
