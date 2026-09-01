#!/usr/bin/env python3
"""Build a real .excalidraw file from the Excalidraw MCP "skeleton" element format.

The MCP `create_view` element format is a SKELETON, not the on-disk schema:

  * `label` on a shape is skeleton-only. Excalidraw's canvas renderer has no text
    branch for rectangle/ellipse/diamond, so a shape carrying an inline `text` or
    `label` property opens as an EMPTY BOX. Real container text is a separate text
    element with `containerId`, plus a `boundElements` entry on the container.
  * `cameraUpdate` / `restoreCheckpoint` are app-only pseudo elements.
  * `delete` is an animation pseudo element.
  * Text geometry is never recomputed on open (`refreshDimensions` is never true in
    the app), so the writer owns x/y/width/height and must pre-wrap lines itself.

This script consumes the skeleton you already wrote for `create_view` and emits a
valid Excalidraw v2 document, so one authoring format serves both the inline
animated render and the file on disk.

Usage:
    python3 excalidraw_build.py IN.json -o OUT.excalidraw
    python3 excalidraw_build.py IN.json -o OUT.excalidraw.md --obsidian
    python3 excalidraw_build.py IN.json -o OUT.excalidraw --dark

IN.json is the JSON array you passed (or would pass) to `create_view`.

Skeleton extensions this builder understands (all optional):
    {"type":"arrow", "from":"box1", "to":"box2", "route":"ortho"}
        Endpoints are computed on each shape's perimeter and bound both ways.
    {"type":"rectangle", "zoneLabel":"Data layer"}
        Emits a top-left caption instead of a centred bound label. Never bind a
        label to a background zone: it centres in the zone and cannot be grabbed.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

# --- verified constants (excalidraw/excalidraw master) -----------------------
# packages/common/src/constants.ts
FONT_FAMILY = {
    "Virgil": 1, "Helvetica": 2, "Cascadia": 3, "Excalifont": 5,
    "Nunito": 6, "Lilita One": 7, "Comic Shanns": 8,
    "Liberation Sans": 9, "Assistant": 10,
}
DEFAULT_FONT_FAMILY = FONT_FAMILY["Excalifont"]  # 5 = current hand-drawn default
# packages/common/src/font-metadata.ts
LINE_HEIGHT = {1: 1.25, 2: 1.15, 3: 1.2, 5: 1.25, 6: 1.25, 7: 1.15, 8: 1.25, 9: 1.15, 10: 1.25}
BOUND_TEXT_PADDING = 5   # packages/common/src/constants.ts
SAFE_PADDING = 6         # our own margin on top of Excalidraw's

MIN_BOX_W, MIN_BOX_H = 120, 60

PSEUDO = {"cameraUpdate", "restoreCheckpoint", "delete"}
CONTAINER_TYPES = {"rectangle", "ellipse", "diamond"}

# --- text metrics ------------------------------------------------------------
# Calibrated per-character em widths. Excalifont is proportional; a flat 0.5
# coefficient under-measures capitals and wide glyphs by up to ~27%, which is how
# labels silently overflow their boxes.
_NARROW = set("iljtfrI!.,:;'`|()[]{}")
_WIDE = set("MWmw@%")


def char_width(c: str) -> float:
    if c == " ":
        return 0.30
    if c in _NARROW:
        return 0.35
    if c in _WIDE:
        return 0.95
    if c.isupper():
        return 0.72
    return 0.55


def line_width(line: str, font_size: float) -> float:
    return sum(char_width(c) for c in line) * font_size


def text_width(text: str, font_size: float) -> float:
    return max((line_width(l, font_size) for l in text.split("\n")), default=0.0)


def text_height(text: str, font_size: float, line_height: float) -> float:
    return len(text.split("\n")) * font_size * line_height


def wrap_text(text: str, font_size: float, max_width: float) -> str:
    """Greedy word wrap. Explicit newlines in the source are always honoured."""
    out = []
    for para in text.split("\n"):
        words, line = para.split(" "), ""
        for w in words:
            cand = w if not line else f"{line} {w}"
            if line and line_width(cand, font_size) > max_width:
                out.append(line)
                line = w
            else:
                line = cand
        out.append(line)
    return "\n".join(out)


# --- deterministic ids/seeds -------------------------------------------------
def stable_int(s: str, salt: int = 0) -> int:
    """Deterministic pseudo-random int. Reproducible builds diff cleanly in git."""
    h = 2166136261
    for ch in f"{s}#{salt}":
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return h % 2147483647 or 1


BASE_DEFAULTS = {
    "angle": 0,
    "strokeColor": "#1e1e1e",
    "backgroundColor": "transparent",
    "fillStyle": "solid",
    "strokeWidth": 2,
    "strokeStyle": "solid",
    "roughness": 1,
    "opacity": 100,
    "groupIds": [],
    "frameId": None,
    "roundness": None,
    "isDeleted": False,
    "boundElements": None,
    "link": None,
    "locked": False,
}


def base_element(el_type: str, eid: str) -> dict:
    e = dict(BASE_DEFAULTS)
    e.update(
        id=eid, type=el_type, seed=stable_int(eid),
        version=1, versionNonce=stable_int(eid, 1), updated=1,
    )
    return e


def make_text(eid, x, y, text, font_size, *, color="#1e1e1e", family=DEFAULT_FONT_FAMILY,
              container_id=None, align="left", valign="top", opacity=100):
    lh = LINE_HEIGHT[family]
    t = base_element("text", eid)
    t.update(
        x=round(x, 2), y=round(y, 2),
        width=round(text_width(text, font_size), 2),
        height=round(text_height(text, font_size, lh), 2),
        fontSize=font_size, fontFamily=family, text=text, originalText=text,
        textAlign=align, verticalAlign=valign, containerId=container_id,
        lineHeight=lh, autoResize=True, strokeColor=color, opacity=opacity,
    )
    return t


# --- geometry ----------------------------------------------------------------
def center(el: dict) -> tuple[float, float]:
    return el["x"] + el.get("width", 0) / 2, el["y"] + el.get("height", 0) / 2


def perimeter_point(el: dict, tx: float, ty: float, gap: float = 4.0) -> tuple[float, float]:
    """Point on `el`'s perimeter along the ray towards (tx, ty), pushed out by gap."""
    cx, cy = center(el)
    dx, dy = tx - cx, ty - cy
    if dx == 0 and dy == 0:
        return cx, cy
    hw, hh = el.get("width", 0) / 2, el.get("height", 0) / 2
    if el["type"] == "ellipse":
        ang = math.atan2(dy, dx)
        px, py = cx + (hw + gap) * math.cos(ang), cy + (hh + gap) * math.sin(ang)
        return px, py
    # rectangle / diamond: scale the ray to the box edge
    sx = hw / abs(dx) if dx else float("inf")
    sy = hh / abs(dy) if dy else float("inf")
    s = min(sx, sy)
    px, py = cx + dx * s, cy + dy * s
    n = math.hypot(dx, dy)
    return px + dx / n * gap, py + dy / n * gap


def ortho_points(x1, y1, x2, y2) -> list[list[float]]:
    """L-shaped route: leave horizontally when the run is mostly horizontal."""
    if abs(x2 - x1) >= abs(y2 - y1):
        mid = (x1 + x2) / 2
        return [[0, 0], [mid - x1, 0], [mid - x1, y2 - y1], [x2 - x1, y2 - y1]]
    mid = (y1 + y2) / 2
    return [[0, 0], [0, mid - y1], [x2 - x1, mid - y1], [x2 - x1, y2 - y1]]


def path_length(points) -> float:
    return sum(
        math.dist(points[i], points[i + 1]) for i in range(len(points) - 1)
    )


# --- builder -----------------------------------------------------------------
class Builder:
    def __init__(self, skeleton: list, dark: bool = False):
        self.src = [e for e in skeleton if isinstance(e, dict)]
        self.dark = dark
        self.out: list[dict] = []
        self.by_id: dict[str, dict] = {}
        self.warnings: list[str] = []

    def build(self) -> list[dict]:
        deleted: set[str] = set()
        for raw in self.src:
            t = raw.get("type")
            if t == "delete":
                deleted.update(i.strip() for i in str(raw.get("ids", "")).split(",") if i.strip())
                continue
            if t in PSEUDO:
                continue
            if t == "arrow":
                self._arrow(raw)
            elif t == "text":
                self._text(raw)
            elif t in CONTAINER_TYPES:
                self._shape(raw)
            elif t in ("line", "freedraw", "frame"):
                self._passthrough(raw)
            else:
                self.warnings.append(f"skipped unsupported element type {t!r}")
        if deleted:
            self.out = [
                e for e in self.out
                if e["id"] not in deleted and e.get("containerId") not in deleted
            ]
        self._prune_dangling()
        self._assign_index()
        return self.out

    # -- element emitters
    def _emit(self, el: dict) -> dict:
        if el["id"] in self.by_id:
            raise SystemExit(f"duplicate element id: {el['id']!r}")
        self.by_id[el["id"]] = el
        self.out.append(el)
        return el

    def _copy_style(self, dst: dict, raw: dict):
        for k in ("strokeColor", "backgroundColor", "fillStyle", "strokeWidth",
                  "strokeStyle", "roughness", "opacity", "roundness", "angle",
                  "groupIds", "link", "locked"):
            if k in raw:
                dst[k] = raw[k]

    def _shape(self, raw: dict):
        eid = raw["id"]
        label = raw.get("label")
        zone_label = raw.get("zoneLabel")
        w = float(raw.get("width", MIN_BOX_W))
        h = float(raw.get("height", MIN_BOX_H))
        text = wrapped = None
        fs = 20

        if label:
            text = label["text"] if isinstance(label, dict) else str(label)
            fs = (label.get("fontSize") if isinstance(label, dict) else None) or 20
            pad = 2 * (BOUND_TEXT_PADDING + SAFE_PADDING)
            # grow the box to the text rather than letting the text overflow
            wrapped = wrap_text(text, fs, max(w - pad, 40))
            need_w = text_width(wrapped, fs) + pad
            need_h = text_height(wrapped, fs, LINE_HEIGHT[DEFAULT_FONT_FAMILY]) + 2 * BOUND_TEXT_PADDING
            if need_w > w:
                if raw.get("fixedWidth"):
                    wrapped = wrap_text(text, fs, w - pad)
                    need_h = text_height(wrapped, fs, LINE_HEIGHT[DEFAULT_FONT_FAMILY]) + 2 * BOUND_TEXT_PADDING
                else:
                    w = math.ceil(need_w)
            h = max(h, math.ceil(need_h))

        el = base_element(raw["type"], eid)
        el.update(x=float(raw["x"]), y=float(raw["y"]), width=w, height=h)
        self._copy_style(el, raw)
        self._emit(el)

        if wrapped is not None:
            tid = f"{eid}-label"
            lw = text_width(wrapped, fs)
            lh = text_height(wrapped, fs, LINE_HEIGHT[DEFAULT_FONT_FAMILY])
            t = make_text(
                tid, el["x"] + (w - lw) / 2, el["y"] + (h - lh) / 2, wrapped, fs,
                color=(label.get("strokeColor") if isinstance(label, dict) else None)
                or ("#e5e5e5" if self.dark else "#1e1e1e"),
                container_id=eid, align="center", valign="middle",
            )
            el["boundElements"] = (el["boundElements"] or []) + [{"type": "text", "id": tid}]
            self._emit(t)

        if zone_label:
            zt = zone_label if isinstance(zone_label, str) else zone_label["text"]
            zfs = 16 if isinstance(zone_label, str) else zone_label.get("fontSize", 16)
            self._emit(make_text(
                f"{eid}-zone", el["x"] + 12, el["y"] + 8, zt, zfs,
                color=raw.get("strokeColor", "#1e1e1e"),
            ))

    def _text(self, raw: dict):
        fs = float(raw.get("fontSize", 20))
        txt = raw["text"]
        t = make_text(
            raw["id"], float(raw.get("x", 0)), float(raw["y"]), txt, fs,
            color=raw.get("strokeColor", "#e5e5e5" if self.dark else "#1e1e1e"),
            align=raw.get("textAlign", "left"),
            valign=raw.get("verticalAlign", "top"),
            opacity=raw.get("opacity", 100),
        )
        if raw.get("center"):  # {"center": 400} -> centre the text on x=400
            t["x"] = round(float(raw["center"]) - t["width"] / 2, 2)
        self._emit(t)

    def _arrow(self, raw: dict):
        eid = raw["id"]
        start_id, end_id = raw.get("from"), raw.get("to")
        binding_start = binding_end = None

        if start_id and end_id:
            a, b = self.by_id.get(start_id), self.by_id.get(end_id)
            if not a or not b:
                raise SystemExit(f"arrow {eid!r}: from/to must reference shapes defined EARLIER ({start_id}, {end_id})")
            acx, acy = center(a)
            bcx, bcy = center(b)
            x1, y1 = perimeter_point(a, bcx, bcy)
            x2, y2 = perimeter_point(b, acx, acy)
            pts = (ortho_points(x1, y1, x2, y2) if raw.get("route") == "ortho"
                   else [[0.0, 0.0], [x2 - x1, y2 - y1]])
            ox, oy = x1, y1
            binding_start = {"elementId": start_id, "focus": 0, "gap": 4}
            binding_end = {"elementId": end_id, "focus": 0, "gap": 4}
        else:
            pts = [[float(p[0]), float(p[1])] for p in raw["points"]]
            ox, oy = float(raw["x"]), float(raw["y"])
            # points are relative to x,y and points[0] must be the origin
            p0x, p0y = pts[0]
            if (p0x, p0y) != (0.0, 0.0):
                ox, oy = ox + p0x, oy + p0y
                pts = [[px - p0x, py - p0y] for px, py in pts]
            for side, key in (("start", "startBinding"), ("end", "endBinding")):
                b = raw.get(key)
                if b and b.get("elementId"):
                    binding = {"elementId": b["elementId"], "focus": b.get("focus", 0), "gap": b.get("gap", 4)}
                    if side == "start":
                        binding_start = binding
                    else:
                        binding_end = binding

        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        el = base_element("arrow", eid)
        el.update(
            x=round(ox, 2), y=round(oy, 2),
            # getSizeFromPoints: extents of the points, never negative
            width=round(max(xs) - min(xs), 2), height=round(max(ys) - min(ys), 2),
            points=[[round(p[0], 2), round(p[1], 2)] for p in pts],
            lastCommittedPoint=None,
            startBinding=binding_start, endBinding=binding_end,
            startArrowhead=raw.get("startArrowhead"),
            endArrowhead=raw.get("endArrowhead", "arrow"),
            elbowed=bool(raw.get("elbowed", False)),
        )
        self._copy_style(el, raw)
        self._emit(el)

        # Excalidraw does not repair arrow<->shape reciprocity: write it ourselves.
        for b in (binding_start, binding_end):
            if b and b["elementId"] in self.by_id:
                tgt = self.by_id[b["elementId"]]
                tgt["boundElements"] = (tgt["boundElements"] or []) + [{"type": "arrow", "id": eid}]

        label = raw.get("label")
        if label:
            txt = label["text"] if isinstance(label, dict) else str(label)
            fs = (label.get("fontSize") if isinstance(label, dict) else None) or 16
            plen = path_length(pts)
            if text_width(txt, fs) > plen - 20:
                self.warnings.append(
                    f"arrow {eid!r}: label {txt!r} (~{text_width(txt, fs):.0f}px) is wider than its "
                    f"{plen:.0f}px path; shorten it or lengthen the arrow"
                )
            tid = f"{eid}-label"
            lw, lh = text_width(txt, fs), text_height(txt, fs, LINE_HEIGHT[DEFAULT_FONT_FAMILY])
            mx, my = ox + (min(xs) + max(xs)) / 2, oy + (min(ys) + max(ys)) / 2
            t = make_text(tid, mx - lw / 2, my - lh / 2, txt, fs,
                          color=el.get("strokeColor", "#1e1e1e"),
                          container_id=eid, align="center", valign="middle")
            el["boundElements"] = (el["boundElements"] or []) + [{"type": "text", "id": tid}]
            self._emit(t)

    def _passthrough(self, raw: dict):
        el = base_element(raw["type"], raw["id"])
        el.update({k: v for k, v in raw.items() if k not in ("type",)})
        el.setdefault("width", 0)
        el.setdefault("height", 0)
        self._emit(el)

    # -- housekeeping
    def _prune_dangling(self):
        ids = {e["id"] for e in self.out}
        for e in self.out:
            if e.get("containerId") and e["containerId"] not in ids:
                e["containerId"] = None
            if e.get("boundElements"):
                kept = [b for b in e["boundElements"] if b["id"] in ids]
                e["boundElements"] = kept or None
            for k in ("startBinding", "endBinding"):
                if e.get(k) and e[k]["elementId"] not in ids:
                    e[k] = None

    def _assign_index(self):
        # Bound text must sit immediately after its container; fractional indices
        # keep z-order stable across edits.
        ordered, seen = [], set()
        texts = {e["containerId"]: e for e in self.out if e.get("containerId")}
        for e in self.out:
            if e["id"] in seen:
                continue
            if e.get("containerId"):
                continue
            ordered.append(e)
            seen.add(e["id"])
            bound = texts.get(e["id"])
            if bound:
                ordered.append(bound)
                seen.add(bound["id"])
        for e in self.out:
            if e["id"] not in seen:
                ordered.append(e)
        for i, e in enumerate(ordered):
            e["index"] = f"a{i:04d}"
        self.out = ordered


# --- output ------------------------------------------------------------------
def document(elements: list[dict], dark: bool) -> dict:
    return {
        "type": "excalidraw",
        "version": 2,
        "source": "https://excalidraw.com",
        "elements": elements,
        "appState": {
            "gridSize": None,
            "viewBackgroundColor": "#121212" if dark else "#ffffff",
        },
        "files": {},
    }


OBSIDIAN_HEADER = """---

excalidraw-plugin: parsed
tags: [excalidraw]

---
==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠==


"""


def sanitize_ids_for_obsidian(doc: dict) -> dict:
    """Obsidian block references accept only [A-Za-z0-9-].

    Every `^ref` in the Text Elements section must equal its element id, so ids
    carrying underscores or dots would silently break block links.
    """
    remap = {}
    for e in doc["elements"]:
        clean = re.sub(r"[^A-Za-z0-9-]", "-", e["id"])
        if clean != e["id"]:
            while clean in remap.values():
                clean += "-x"
            remap[e["id"]] = clean
    if not remap:
        return doc
    for e in doc["elements"]:
        e["id"] = remap.get(e["id"], e["id"])
        if e.get("containerId"):
            e["containerId"] = remap.get(e["containerId"], e["containerId"])
        for b in e.get("boundElements") or []:
            b["id"] = remap.get(b["id"], b["id"])
        for k in ("startBinding", "endBinding"):
            if e.get(k):
                e[k]["elementId"] = remap.get(e[k]["elementId"], e[k]["elementId"])
    return doc


def obsidian_markdown(doc: dict) -> str:
    """Wrap a scene in the Obsidian Excalidraw plugin's parsed-markdown form.

    The plugin reads both ```compressed-json and plain ```json fences; plain JSON
    stays diffable in git, and the plugin re-compresses on first save when the
    vault has compress: true.
    """
    doc = sanitize_ids_for_obsidian(doc)
    texts = [e for e in doc["elements"] if e["type"] == "text"]
    out = [OBSIDIAN_HEADER]
    if texts:
        out.append("# Excalidraw Data\n\n## Text Elements\n")
        for t in texts:
            out.append(f"{t['text']} ^{t['id']}\n\n")
        out.append("%%\n")
    else:
        out.append("%%\n")
    doc = dict(doc, source="https://github.com/zsviczian/obsidian-excalidraw-plugin")
    out.append("## Drawing\n```json\n" + json.dumps(doc) + "\n```\n%%")
    return "".join(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", help="JSON array of MCP skeleton elements ('-' for stdin)")
    ap.add_argument("-o", "--out", required=True, help="output path")
    ap.add_argument("--obsidian", action="store_true", help="emit Obsidian .excalidraw.md")
    ap.add_argument("--dark", action="store_true", help="dark canvas background + light default text")
    args = ap.parse_args()

    raw = sys.stdin.read() if args.input == "-" else Path(args.input).read_text()
    skeleton = json.loads(raw)
    if not isinstance(skeleton, list):
        skeleton = skeleton.get("elements", [])

    b = Builder(skeleton, dark=args.dark)
    doc = document(b.build(), args.dark)

    out = Path(args.out)
    if args.obsidian and not out.name.endswith(".excalidraw.md"):
        out = out.with_suffix("") if out.suffix == ".md" else out
        out = Path(str(out).removesuffix(".excalidraw") + ".excalidraw.md")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(obsidian_markdown(doc) if args.obsidian else json.dumps(doc, indent=2))

    for w in b.warnings:
        print(f"warn: {w}", file=sys.stderr)
    print(f"{out}  ({len(doc['elements'])} elements)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
