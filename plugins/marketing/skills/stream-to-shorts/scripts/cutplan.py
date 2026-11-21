"""Cut plan for vertical shorts: tight cuts, shots, crop windows, output timeline.

Pure functions, no subprocess. cut_short.py and compile_wide.py build on them.

    from cutplan import expand_shots, timeline, cover
    shots = timeline(expand_shots(spec, words_for=lookup))

Run it as a script to print the shot list of a spec without rendering:

    python3 cutplan.py spec.json [--variant b]

The plan printed this way uses no transcript, so tight segments stay whole.
cut_short.py plan reads the transcripts named in the spec.

Times are seconds. Source rectangles are [x, y, w, h] in source pixels.

Every shot is a whole number of frames long at FPS, so the picture and the
sound of a shot end together and the next shot starts on a frame: see
expand_shots.
"""
import argparse
import json
import math
import sys

FPS = 30               # the cutter renders every shot at this rate
AUDIO_RATE = 48000     # and its sound at this one: 1600 samples a frame
READ_MARGIN = 0.5      # seconds read past a shot's "out"; see read_length
MAX_FRAMES = FPS * 86400   # a span longer than a day on screen is a typing error
SOURCE_EDGE = 0.1      # a read that starts this close to its source's end may find no frame

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
        # No word left to time the cut by: keep the window, less its dropped
        # ranges. A drop that covers the window leaves nothing.
        if not drops:
            return [(a, b)]
        out, s = [], a
        for x, y in sorted(drops):
            if min(x, b) - s > TIGHT["min_span"]:
                out.append((round(s, 3), round(min(x, b), 3)))
            s = max(s, y)
        if b - s > TIGHT["min_span"]:
            out.append((round(s, 3), round(b, 3)))
        return out
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

    Every shot gets "frames", its length in output frames at FPS, and its
    "in" and "out" sit on that grid. A shot rendered to a length between two
    frames leaves its picture a fraction of a frame longer than its sound;
    the join then fills the difference with digital silence and every later
    cut drifts off the planned time. So each span is rounded down to whole
    frames: it never grows into a dropped range or past its "out". A span
    that starts where the one before it ended, on the same picture and sound,
    starts where that one really ended, so nothing is skipped between them.
    """
    mx = spec.get("shot", layout["max_shot"])
    if not _number(mx) or not mx > 0:
        raise PlanError("spec \"shot\" (the longest shot in seconds) must be a number above 0")
    default_src = spec.get("src")
    punch_default = spec.get("punch", layout["punch"])
    res, k = [], 0
    prev = None     # (link, planned end, end on the frame grid) of the last span
    for seg in segments_for(spec, variant):
        src = seg.get("src", default_src)
        if src is None:
            raise PlanError("segment at %s has no source: set spec \"src\" or segment \"src\"" % seg.get("in"))
        sp = seg.get("speed", 1.0)
        if not _number(sp) or not sp > 0:
            raise PlanError("segment at %s: \"speed\" must be a number above 0" % seg.get("in"))
        # Where the sound and the moved picture sit against "in": two segments
        # carry on from each other only when these agree. Read through
        # audio_source, so a default written out ("a_src" equal to "src",
        # "a_in" equal to "in") is the same link as one left out.
        akey, a0 = audio_source(seg, src)
        link = (src, akey, round(a0 - seg["in"], 6), _offset(seg, "g_in"))
        if seg.get("tight") and words_for is not None:
            # Pauses are cut on the sound the viewer hears (see audio_source).
            # When that sound comes from another source or time, the words
            # and "drop" ranges are read in its time, and the spans are then
            # moved back to picture time.
            shift = seg["in"] - a0
            if akey != src or shift:
                aseg = dict(seg)
                aseg["in"], aseg["out"] = a0, a0 + (seg["out"] - seg["in"])
                spans = [(round(s + shift, 3), round(e + shift, 3))
                         for s, e in tight_spans(aseg, words_for(akey, aseg["in"], aseg["out"]), fillers)]
            else:
                spans = tight_spans(seg, words_for(src, seg["in"], seg["out"]), fillers)
        else:
            spans = [(seg["in"], seg["out"])]
        for (a, b) in spans:
            start = a
            if prev and prev[0] == link and abs(a - prev[1]) < 0.0005:
                start = prev[2]
            length = (b - start) / sp * FPS
            if not length <= MAX_FRAMES:
                raise PlanError("segment at %s is over a day long on screen: check \"in\", \"out\" and \"speed\""
                                % seg.get("in"))
            total = int(length + 1e-6)                      # whole output frames, rounded down
            prev = (link, b, start + total * sp / float(FPS))
            if total < 1:
                continue                                    # shorter than one frame
            # The max shot is a length on screen, so a sped-up or slowed span
            # is split by its length after the speed change.
            n = 1 if seg.get("still") else max(1, int(math.ceil(total / float(FPS) / mx - 1e-9)))
            n = min(n, total)
            for i in range(n):
                f0 = (2 * total * i + n) // (2 * n)
                f1 = (2 * total * (i + 1) + n) // (2 * n)
                s = dict(seg)
                s["src"] = src
                s["in"] = round(start + f0 * sp / float(FPS), 3)
                s["out"] = min(round(start + f1 * sp / float(FPS), 3), max(b, s["in"]))
                s["frames"] = f1 - f0
                if "a_in" in seg:
                    s["a_in"] = round(seg["a_in"] + (s["in"] - seg["in"]), 3)
                if "g_in" in seg:
                    s["g_in"] = round(seg["g_in"] + (s["in"] - seg["in"]), 3)
                s["z"] = seg.get("punch", punch_default) if k % 2 else 1.0
                if "z" in seg:
                    s["z"] = seg["z"]
                res.append(s)
                k += 1
    if not res:
        raise PlanError("the cut is empty: every segment was dropped")
    return res


def _number(v):
    """True for a finite int or float; a bool is not a number here."""
    return not isinstance(v, bool) and isinstance(v, (int, float)) and math.isfinite(v)


def _offset(seg, key):
    """How far a segment's "a_in" or "g_in" sits from its "in"; None without one."""
    return round(seg[key] - seg["in"], 6) if key in seg else None


def timeline(shots, fps=FPS):
    """Copy of the shots with t0/t1 in output time.

    Shots from expand_shots carry "frames", and their times are counted in
    frames, so a cut is always at a frame. Shots without it (a shot list
    written by hand) last (out - in) / speed.
    """
    res, t, f = [], 0.0, 0
    grid = all("frames" in s for s in shots)
    for s in shots:
        s = dict(s)
        if grid:
            s["t0"] = round(f / float(fps), 3)
            f += s["frames"]
            s["t1"] = round(f / float(fps), 3)
        else:
            d = s["out"] - s["in"]
            s["t0"] = round(t, 3)
            t += d / s.get("speed", 1.0)
            s["t1"] = round(t, 3)
        res.append(s)
    return res


def cut_frames(shots):
    """Frame numbers of the cuts: where each shot starts, then where the last
    one ends. None when a shot has no "frames" (a plan made before the grid)."""
    if not shots or not all("frames" in s for s in shots):
        return None
    out, f = [0], 0
    for s in shots:
        f += s["frames"]
        out.append(f)
    return out


def snap_label(at, dur, cuts, fps=FPS):
    """(first frame, end frame) of a label typed as `at` and `dur` seconds.

    A label belongs to a shot: it starts on a cut and ends on a later cut, so
    it never sits over the picture before its own. The start is the cut
    nearest to `at`, the end the later cut nearest to `at + dur`. None for a
    label typed at or past the end of the cut: it belongs to no shot of this
    cut (a variant can be shorter than the cut the label was typed for).
    """
    if not _number(at) or not _number(dur) or at < 0 or not dur > 0:
        raise PlanError("a label needs \"at\" of 0 or more and \"dur\" above 0, in seconds")
    if not cuts or len(cuts) < 2:
        raise PlanError("no cuts to put a label on")
    if at >= cuts[-1] / float(fps):
        return None
    start = min(cuts[:-1], key=lambda c: (abs(c / float(fps) - at), c))
    end = min((c for c in cuts if c > start), key=lambda c: (abs(c / float(fps) - (at + dur)), c))
    return start, end


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
    fy = int(min(max(0, fy + shot.get("face_dy", 0)), src_h - fh))   # stays inside the source
    return {"layout": "stack", "screen": screen, "face": (fx, fy, fw, fh)}


def shot_video_filter(shot, layout_name, src_w, src_h, facecam=None, layout=DEFAULT_LAYOUT):
    """ffmpeg filter_complex video part for one shot. Input 0 is the source at "in",
    input 1 the source at "g_in" when present. Output label [v]."""
    win = shot_windows(shot, layout_name, src_w, src_h, facecam, layout)
    W, H = layout["width"], layout["height"]
    grid = shot_grid(shot)
    if win["layout"] == "full":
        x, y, w, h = win["screen"]
        return ("[0:v]setpts=PTS-STARTPTS%s,crop=%d:%d:%d:%d,scale=%d:%d:flags=lanczos,setsar=1[v]"
                % (grid, w, h, x, y, W, H))
    st = layout["stack"]
    x, y, w, h = win["screen"]
    fx, fy, fw, fh = win["face"]
    gin = "g_in" in shot
    gi = ("[1:v]setpts=PTS-STARTPTS%s[g]" if gin else "[0:v]setpts=PTS-STARTPTS%s,split=2[g][f]") % grid
    fi = ("[0:v]setpts=PTS-STARTPTS%s," % grid) if gin else "[f]"
    sharp = ",unsharp=5:5:0.6" if st["face_h"] / float(fh) > layout["sharpen_over"] else ""
    return (gi + ";"
            "[g]crop=%d:%d:%d:%d,scale=%d:%d:flags=lanczos[gg];" % (w, h, x, y, W, st["screen_h"])
            + "%scrop=%d:%d:%d:%d,scale=%d:%d:flags=lanczos%s,pad=%d:%d:0:0:white[ff];"
            % (fi, fw, fh, fx, fy, W, st["face_h"], sharp, W, st["face_h"] + layout["bar_h"])
            + "[ff][gg]vstack,setsar=1[v]")


def shot_audio_filter(shot):
    """ffmpeg audio part for one shot: 10 ms fades at both cut points. Output label [a2].
    A shot with "frames" is padded or trimmed to exactly that many frames of
    sound, so it is never shorter than its picture. The sound is cut at the
    shot's own length first: the input is read past the shot (read_length),
    and none of that may be heard, however short the shot is."""
    d = shot["out"] - shot["in"]
    sp = shot.get("speed", 1.0)
    fo = max(0, d - 0.012)
    gate = ("agate=threshold=%s:ratio=9:attack=4:release=90:range=0.05," % shot["gate"]) if shot.get("gate") else ""
    pad = "[1:a]" if "a_in" in shot and "g_in" not in shot else "[0:a]"
    return (pad + "asetpts=PTS-STARTPTS,atrim=end=%.6f," % d + gate + "volume=%s,afade=t=in:d=0.01,afade=t=out:st=%.3f:d=0.01" % (shot.get("vol", 1.0), fo)
            + ("," + tempo_chain(sp) if sp != 1 else "") + _exact_length(shot) + "[a2]")


def shot_grid(shot):
    """Filters that put one picture input of a shot on the output grid: the
    speed change, then exactly "frames" frames at FPS. They follow
    setpts=PTS-STARTPTS on every picture input, before any crop or scale.

    A cap on the frame count is not enough. A source at another frame rate, or
    a slowed shot, runs out of frames before the count is reached (24 frames a
    second gives 17 frames for 0.733 s, which reach 21 of the 23 planned), and
    the encoder then ends the sound with the picture. So the picture is put on
    the FPS grid from time 0, its last frame is held, and the count cuts it.
    This is done first because the scale filter does not pass on the time its
    input ends at: after it the last real frame of a shot that ends with its
    source is dropped and the one before it held in its place.
    """
    sp = shot.get("speed", 1.0)
    out = (",setpts=PTS/%s" % sp) if sp != 1 else ""
    if "frames" in shot:
        out += ",fps=%d:start_time=0,tpad=stop_mode=clone:stop=-1,trim=end_frame=%d" % (FPS, shot["frames"])
    return out


SHOT_VIDEO_OUT = ";[v]null[v2]"     # the picture chain of a shot ends in [v2]


def tempo_chain(speed):
    """atempo filters for a speed. One atempo takes 0.5 to 100, so a speed
    outside that is reached in steps."""
    parts, rest = [], float(speed)
    while rest < 0.5:
        parts.append(0.5)
        rest /= 0.5
    while rest > 100.0:
        parts.append(100.0)
        rest /= 100.0
    if rest != 1.0 or not parts:
        parts.append(rest)
    return ",".join("atempo=%s" % x for x in parts)


def read_length(shot):
    """Seconds of source to read for a shot: its length and READ_MARGIN more.

    With a read that ends exactly where the shot ends, how long the last
    frame is shown depends on the end time the decoder reports for the
    stream, and not every filter or build passes that on. Reading past the
    end makes the frames after the shot real input, so the picture never
    leans on it. The extra is not used: shot_grid cuts the picture at the
    frame count, and shot_audio_filter cuts the sound at the shot's length
    before anything else.
    """
    return shot["out"] - shot["in"] + READ_MARGIN


def past_end(shots, lengths):
    """Reads of a shot that run past the end of a source:
    [{"shot", "field", "key", "start", "end", "have", "nothing"}].

    lengths maps a source key to its length in seconds (None when unknown).
    "field" is the spec field the read starts at ("in", "g_in" or "a_in"),
    "start" and "end" its range in source time and "have" the source's
    length. A shot that ends past the source still renders to its planned
    length, on a held last frame and silence, so it has to be reported. One
    that starts there, or within SOURCE_EDGE of the end (after the last frame
    of a source at 15 frames a second), may have no frame to show at all:
    "nothing" is True, whether or not it also ends past the source. Pure.
    """
    out = []
    for s in shots:
        d = s["out"] - s["in"]
        reads = [("in", s["src"], s["in"])]
        if "g_in" in s:
            reads.append(("g_in", s["src"], s["g_in"]))
        elif "a_in" in s:
            reads.append(("a_in", s.get("a_src", s["src"]), s["a_in"]))
        for field, key, start in reads:
            have = lengths.get(key)
            if have is not None and (start + d > have + 0.05 or start > have - SOURCE_EDGE):
                out.append({"shot": s, "field": field, "key": key, "start": start, "end": round(start + d, 3),
                            "have": have, "nothing": start > have - SOURCE_EDGE})
    return out


def _exact_length(shot):
    if "frames" not in shot:
        return ""
    n = shot["frames"] * (AUDIO_RATE // FPS)
    return ",aresample=%d,apad=whole_len=%d,atrim=end_sample=%d" % (AUDIO_RATE, n, n)


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
    except (TypeError, AttributeError, ArithmeticError) as e:
        print("cutplan: the spec is not in the expected form (%s). Check it with cut_short.py plan" % e, file=sys.stderr)
        return 1
    for s in shots:
        print("%6.2f %5.2f  %s %.2f-%.2f z%s" % (s["t0"], s["t1"] - s["t0"], s["src"], s["in"], s["out"], s["z"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
