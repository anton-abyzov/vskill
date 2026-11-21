"""Cut plan for vertical shorts: tight cuts, shots, crop windows, output timeline.

Pure functions, no subprocess. cut_short.py and compile_wide.py build on them.

    from cutplan import expand_shots, timeline, cover
    shots = timeline(expand_shots(spec, words_for=lookup))

Run it as a script to print the shot list of a spec without rendering:

    python3 cutplan.py spec.json [--variant b]

The plan printed this way uses no transcript, so tight segments stay whole.
cut_short.py plan reads the transcripts named in the spec.

Times are seconds. Source rectangles are [x, y, w, h] in source pixels.
"""
import argparse
import json
import sys

# Layout numbers. Taken from the constants of the cutter that ran
# (canvas 1080x1920, face 0..640, title bar 640..760, screen 760..1920).
DEFAULT_LAYOUT = {
    "width": 1080,
    "height": 1920,
    "center_x": 476,          # horizontal centre for captions, title and labels
    "bar_h": 120,             # title bar height
    "label_max_y": 1200,      # labels never sit lower than this
    "max_shot": 1.45,         # longest shot before an automatic split
    "punch": 1.08,            # zoom on every second shot
    "max_zoom": 2.0,          # a window is never under panel_height / max_zoom source pixels tall
    "stack": {
        "face_y": 0, "face_h": 640,
        "bar_y": 640,
        "screen_y": 760, "screen_h": 1160,
        "cap_y": 555,
        "label_y": 850,
    },
    "full": {
        "bar_y": 288,
        "cap_y": 1120,
        "label_y": 520,
    },
    # screen window used when a stack segment has neither "win" nor "crop",
    # as fractions of the source size (280, 40, 1360, 900 on 1920x1080)
    "screen_default": [280 / 1920.0, 40 / 1080.0, 1360 / 1920.0, 900 / 1080.0],
    "sharpen_over": 2.0,      # sharpen the face panel when it is upscaled more than this
}

# Tight cut rules.
TIGHT = {
    "gap": 0.3,         # pause longer than this splits a group (segment "gap" overrides)
    "lead_in": 0.10,    # lead-in before the first word of a segment
    "hold": 0.9,        # a word counts for at most this long after its start
    "min_span": 0.12,   # spans this short or shorter are dropped
}

DEFAULT_FILLERS = frozenset(["uh", "um", "uh,", "um,", "uh.", "um.", "uhh", "umm"])


class PlanError(ValueError):
    """A spec that cannot be planned. The message says what to fix."""


def words_in_window(words, a, b):
    """Source words that belong to the segment [a, b] (start within a-0.05 .. b)."""
    return [dict(w) for w in words if w["s"] >= a - 0.05 and w["s"] < b]


def tight_spans(seg, words, fillers=DEFAULT_FILLERS):
    """Spans (start, end) in source time for one segment.

    Without "tight" the segment is one span. With "tight", pauses longer than
    the gap are cut out using word timings, filler words are dropped, and
    "drop" ranges are removed; a span never bleeds into a dropped range.
    `words` are the source words of this segment (see words_in_window).
    """
    a, b = seg["in"], seg["out"]
    if not seg.get("tight"):
        return [(a, b)]
    drops = seg.get("drop", [])
    ws = [w for w in words
          if w["w"].lower() not in fillers and not any(x <= (w["s"] + w["e"]) / 2 < y for x, y in drops)]
    if not ws:
        return [(a, b)]
    gap = seg.get("gap", TIGHT["gap"])
    groups, cur = [], [ws[0]]
    for w in ws[1:]:
        dropped_between = any(cur[-1]["e"] <= x and y <= w["s"] + 0.05 for x, y in drops)
        if w["s"] - cur[-1]["e"] > gap or dropped_between:
            groups.append(cur)
            cur = []
        cur.append(w)
    groups.append(cur)
    out = []
    for i, g in enumerate(groups):
        s = max(a, g[0]["s"] - (TIGHT["lead_in"] if i == 0 else gap / 2))
        e = min(b, min(g[-1]["e"], g[-1]["s"] + TIGHT["hold"]) + gap / 2)
        for x, y in drops:                      # never bleed into a dropped range
            if s < y <= g[0]["s"] + 0.02:
                s = max(s, y)
            if g[-1]["s"] < x < e:
                e = x
        if out and s < out[-1][1]:
            s = out[-1][1]
        if e - s > TIGHT["min_span"]:
            out.append((round(s, 3), round(e, 3)))
    return out


def segments_for(spec, variant=None):
    """The segment list of the spec or of one of its variants."""
    segs = spec["segments"]
    if variant:
        variants = spec.get("variants", {})
        if variant not in variants:
            raise PlanError("variant %r is not in the spec (have: %s)" % (variant, ", ".join(sorted(variants)) or "none"))
        if "segments" in variants[variant]:
            segs = variants[variant]["segments"]
    return segs


def expand_shots(spec, variant=None, words_for=None, layout=DEFAULT_LAYOUT, fillers=DEFAULT_FILLERS):
    """Expand segments to shots no longer than the max shot, punching in on every second shot.

    words_for(src_key, a, b) returns source words for a tight segment. When it
    is None, tight segments are kept whole. Each shot gets "src" (the picture
    source key), its own "in"/"out", shifted "a_in"/"g_in" and a zoom "z".
    A segment "punch" sets the zoom of its punched shots, a segment "z" fixes
    it, and "still" keeps a segment as one shot.
    """
    mx = spec.get("shot", layout["max_shot"])
    default_src = spec.get("src")
    punch_default = spec.get("punch", layout["punch"])
    res, k = [], 0
    for seg in segments_for(spec, variant):
        src = seg.get("src", default_src)
        if src is None:
            raise PlanError("segment at %s has no source: set spec \"src\" or segment \"src\"" % seg.get("in"))
        if seg.get("tight") and words_for is not None:
            akey = seg.get("a_src", src)
            spans = tight_spans(seg, words_for(akey, seg["in"], seg["out"]), fillers)
        else:
            spans = [(seg["in"], seg["out"])]
        for (a, b) in spans:
            d = b - a
            n = 1 if seg.get("still") else max(1, int(-(-d // mx)))
            for i in range(n):
                s = dict(seg)
                s["src"] = src
                s["in"] = round(a + d * i / n, 3)
                s["out"] = round(a + d * (i + 1) / n, 3)
                if "a_in" in seg:
                    s["a_in"] = round(seg["a_in"] + (s["in"] - seg["in"]), 3)
                if "g_in" in seg:
                    s["g_in"] = round(seg["g_in"] + (s["in"] - seg["in"]), 3)
                s["z"] = seg.get("punch", punch_default) if k % 2 else 1.0
                if "z" in seg:
                    s["z"] = seg["z"]
                res.append(s)
                k += 1
    return res


def timeline(shots):
    """Copy of the shots with t0/t1 in output time (a shot lasts (out - in) / speed)."""
    res, t = [], 0.0
    for s in shots:
        s = dict(s)
        d = s["out"] - s["in"]
        s["t0"] = round(t, 3)
        t += d / s.get("speed", 1.0)
        s["t1"] = round(t, 3)
        res.append(s)
    return res


def audio_source(shot, default_src=None):
    """(source key, source time) where the shot's sound starts.

    Sound follows "a_in" (from "a_src") only when the shot has no "g_in";
    with "g_in" the picture moves and the sound stays at "in".
    """
    src = shot.get("src", default_src)
    if "a_in" in shot and "g_in" not in shot:
        return shot.get("a_src", src), shot["a_in"]
    return src, shot["in"]


def map_words(source_words, shots, default_src=None):
    """Map source-time words to output time through the shot timeline.

    source_words is a list (one source) or {src_key: list}. Shots need t0/t1
    (see timeline). A word is kept when its midpoint falls inside a shot's
    sound; its times are clipped to that shot.
    """
    out = []
    for s in shots:
        key, ain = audio_source(s, default_src)
        ws = source_words.get(key, []) if isinstance(source_words, dict) else source_words
        d = s["out"] - s["in"]
        sp = s.get("speed", 1.0)
        for w in ws:
            mid = (w["s"] + w["e"]) / 2
            if ain <= mid < ain + d:
                t0 = max(s["t0"], s["t0"] + (w["s"] - ain) / sp)
                t1 = min(s["t1"], s["t0"] + (w["e"] - ain) / sp)
                out.append({"w": w["w"], "s": round(t0, 2), "e": round(max(t0, t1), 2)})
    out.sort(key=lambda w: w["s"])
    return out


def zoomed(c, z, minw=540):
    """Crop c zoomed in by z around its centre, never narrower than minw (unless c already is)."""
    x, y, w, h = c
    w2 = max(minw if w >= minw else w, w / z)
    h2 = h * w2 / w
    return (int(x + (w - w2) / 2), int(y + (h - h2) / 2), int(w2 / 2) * 2, int(h2 / 2) * 2)


def cover(c, tw, th, z=1.0, min_h=None, focus=None, src_w=1920, src_h=1080):
    """Window with aspect tw:th inside the source, centred on crop c (or focus).

    Height comes from c divided by z, never under min_h (the zoom cap). Without
    min_h the window is never wider than c (face boxes). The window is clamped
    to the source and its size rounded down to even numbers.
    """
    x, y, w, h = c
    cx, cy = focus if focus else (x + w / 2, y + h / 2)
    hh = h / z
    if hh * tw / th > w / z and not min_h:
        hh = (w / z) * th / tw
    if min_h:
        hh = max(min_h, hh)
    hh = min(src_h, hh)
    ww = hh * tw / th
    if ww > src_w:
        ww = src_w
        hh = ww * th / tw
    x0 = min(max(0, cx - ww / 2), src_w - ww)
    y0 = min(max(0, cy - hh / 2), src_h - hh)
    return int(x0), int(y0), int(ww / 2) * 2, int(hh / 2) * 2


def full_default_crop(src_w, src_h):
    """Centred 9:16 column of the source (656, 0, 608, 1080 on 1920x1080)."""
    w = 2 * int(round(src_h * 9 / 16.0 / 2))
    return [int((src_w - w) / 2), 0, w, src_h]


def screen_default_crop(src_w, src_h, layout=DEFAULT_LAYOUT):
    fx, fy, fw, fh = layout["screen_default"]
    return [int(round(src_w * fx)), int(round(src_h * fy)), int(round(src_w * fw)), int(round(src_h * fh))]


def shot_windows(shot, layout_name, src_w, src_h, facecam=None, layout=DEFAULT_LAYOUT):
    """Source windows of one vertical shot: {"screen": (x, y, w, h), "face": (...) or None}."""
    lay = shot.get("layout", layout_name)
    z = shot.get("z", 1.0)
    W, H = layout["width"], layout["height"]
    if lay == "full":
        c = shot.get("crop") or full_default_crop(src_w, src_h)
        return {"layout": "full",
                "screen": cover(c, W, H, z, H / layout["max_zoom"], shot.get("focus"), src_w, src_h),
                "face": None}
    if lay != "stack":
        raise PlanError("unknown layout %r (use \"stack\" or \"full\")" % lay)
    st = layout["stack"]
    c = shot.get("win") or shot.get("crop") or screen_default_crop(src_w, src_h, layout)
    screen = cover(c, W, st["screen_h"], z, st["screen_h"] / shot.get("max_zoom", layout["max_zoom"]),
                   shot.get("focus"), src_w, src_h)
    face_box = shot.get("face") or facecam
    if not face_box:
        raise PlanError("stack layout needs a facecam box: set spec \"facecam\": [x, y, w, h] "
                        "(the face area of the stream overlay, in source pixels) or segment \"face\"")
    fx, fy, fw, fh = cover(face_box, W, st["face_h"], src_w=src_w, src_h=src_h)
    fy = max(0, fy + shot.get("face_dy", 0))
    return {"layout": "stack", "screen": screen, "face": (fx, fy, fw, fh)}


def shot_video_filter(shot, layout_name, src_w, src_h, facecam=None, layout=DEFAULT_LAYOUT):
    """ffmpeg filter_complex video part for one shot. Input 0 is the source at "in",
    input 1 the source at "g_in" when present. Output label [v]."""
    win = shot_windows(shot, layout_name, src_w, src_h, facecam, layout)
    W, H = layout["width"], layout["height"]
    if win["layout"] == "full":
        x, y, w, h = win["screen"]
        return "[0:v]setpts=PTS-STARTPTS,crop=%d:%d:%d:%d,scale=%d:%d:flags=lanczos,setsar=1[v]" % (w, h, x, y, W, H)
    st = layout["stack"]
    x, y, w, h = win["screen"]
    fx, fy, fw, fh = win["face"]
    gin = "g_in" in shot
    gi = "[1:v]setpts=PTS-STARTPTS[g]" if gin else "[0:v]setpts=PTS-STARTPTS,split=2[g][f]"
    fi = "[0:v]setpts=PTS-STARTPTS," if gin else "[f]"
    sharp = ",unsharp=5:5:0.6" if st["face_h"] / float(fh) > layout["sharpen_over"] else ""
    return (gi + ";"
            "[g]crop=%d:%d:%d:%d,scale=%d:%d:flags=lanczos[gg];" % (w, h, x, y, W, st["screen_h"])
            + "%scrop=%d:%d:%d:%d,scale=%d:%d:flags=lanczos%s,pad=%d:%d:0:0:white[ff];"
            % (fi, fw, fh, fx, fy, W, st["face_h"], sharp, W, st["face_h"] + layout["bar_h"])
            + "[ff][gg]vstack,setsar=1[v]")


def shot_audio_filter(shot):
    """ffmpeg audio part for one shot: 10 ms fades at both cut points. Output label [a2]."""
    d = shot["out"] - shot["in"]
    sp = shot.get("speed", 1.0)
    fo = max(0, d - 0.012)
    gate = ("agate=threshold=%s:ratio=9:attack=4:release=90:range=0.05," % shot["gate"]) if shot.get("gate") else ""
    pad = "[1:a]" if "a_in" in shot and "g_in" not in shot else "[0:a]"
    return (pad + "asetpts=PTS-STARTPTS," + gate + "volume=%s,afade=t=in:d=0.01,afade=t=out:st=%.3f:d=0.01" % (shot.get("vol", 1.0), fo)
            + (",atempo=%s" % sp if sp != 1 else "") + "[a2]")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Print the shot list of a cut spec (no transcript, no render).")
    ap.add_argument("spec")
    ap.add_argument("--variant")
    args = ap.parse_args(argv)
    try:
        with open(args.spec) as f:
            spec = json.load(f)
        shots = timeline(expand_shots(spec, args.variant))
    except (OSError, ValueError, KeyError) as e:
        print("cutplan: %s" % e, file=sys.stderr)
        return 1
    for s in shots:
        print("%6.2f %5.2f  %s %.2f-%.2f z%s" % (s["t0"], s["t1"] - s["t0"], s["src"], s["in"], s["out"], s["z"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
