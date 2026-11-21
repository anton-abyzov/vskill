"""Word captions, title bar and labels for a vertical short, as ASS subtitles.

Pure functions, no subprocess. cut_short.py writes the result and burns it with
ffmpeg's ass filter.

    from captions import build_ass
    text = build_ass(spec, words)                  # source language, word by word
    text = build_ass(spec, words, variant="b")     # a hook variant's bar and cap_edit
    text = build_ass(spec, words, lang="es")       # spec["translations"]["es"]

Run it as a script to write the ASS file for a spec and an output-time word list:

    python3 captions.py spec.json words.json out.ass [--variant b] [--lang es]

Words are dicts {"w": text, "s": start, "e": end} in output time.
"""
import argparse
import json
import re
import sys
import textwrap

from cutplan import DEFAULT_LAYOUT, FPS, cut_frames, snap_label

DEFAULT_FONT = "Arial Black"
DEFAULT_COLORS = {
    "active": "&H0000E5FF&",   # the word being said: yellow
    "alt": "&H00FFE500&",      # words inside alt_words ranges (a second speaker): cyan
}
WHITE = "&H00FFFFFF&"

# chunking rule: a new group starts after a gap over 0.4 s, at 3 words,
# when the group would pass 13 characters, or after a sentence end
CHUNK_GAP = 0.4
CHUNK_WORDS = 3
CHUNK_CHARS = 13
TRANSLATION_WRAP = 24


def ass_time(t):
    """Seconds to ASS time h:mm:ss.cc (negative clamps to 0)."""
    t = max(0, t)
    return "%d:%02d:%05.2f" % (t // 3600, t % 3600 // 60, t % 60)


def cut_time(frame, fps=FPS):
    """ASS time for an event that starts or ends on a cut, given as a frame number.

    ASS counts in hundredths of a second and a frame at 30 a second is 3.33 of
    them, so a time rounded to the nearest hundredth can land after its frame
    and show the event one frame late. This is the last hundredth before the
    frame's own time: after the frame before it, never after the frame.
    """
    cs = max(0, (int(frame) * 100 + fps - 1) // fps - 1)
    return "%d:%02d:%02d.%02d" % (cs // 360000, cs // 6000 % 60, cs // 100 % 60, cs % 100)


def placed_labels(spec, shots=None):
    """Where each label of the spec goes: [(label, start, end, first frame, end frame)].

    With the shot list every label is moved onto the cuts (see
    cutplan.snap_label) and start and end are the cut times; the frames are
    None without a shot list on the frame grid, and the typed times are kept.
    """
    cuts = cut_frames(shots) if shots else None
    out = []
    for lb in spec.get("labels", []):
        if cuts:
            f0, f1 = snap_label(lb["at"], lb["dur"], cuts)
            out.append((lb, round(f0 / float(FPS), 3), round(f1 / float(FPS), 3), f0, f1))
        else:
            out.append((lb, lb["at"], lb["at"] + lb["dur"], None, None))
    return out


def bar_font_size(text, width=780, char_w=0.52, caps=(74, 46)):
    """Title bar font size: fits the longest line in `width`, capped at 74 (one line) or 46 (two)."""
    lines = text.split("\n")
    n = max(len(line) for line in lines)
    cap = caps[0] if len(lines) == 1 else caps[1]
    if not n:
        return cap
    return int(min(cap, width / (char_w * n)))


def ass_text(s):
    """Text for a Dialogue line: braces escaped, so "{x}" from a code stream is
    shown and not read as an override tag; line breaks become \\N."""
    s = str(s).replace("\r\n", "\n").replace("\r", "\n")
    return s.replace("{", "\\{").replace("}", "\\}").replace("\n", "\\N")


def ass_color(c):
    """"#RRGGBB" or an ASS colour "&HAABBGGRR&" to the ASS form."""
    c = str(c).strip()
    if c.upper().startswith("&H"):
        return c if c.endswith("&") else c + "&"
    m = re.match(r"^#?([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})$", c)
    if not m:
        raise ValueError("colour %r is not #RRGGBB or &HAABBGGRR&" % c)
    r, g, b = m.groups()
    return "&H00%s&" % (b + g + r).upper()


def apply_fixes(words, fix=None, cap_edit=None):
    """Word corrections. fix maps a word (exact, then lower case) to its replacement;
    cap_edit [[t0, t1, text]] replaces every word starting in [t0, t1). An empty
    replacement removes the word."""
    fix = fix or {}
    out = []
    for w in words:
        w = dict(w)
        w["w"] = fix.get(w["w"], fix.get(w["w"].lower(), w["w"]))
        for a, b, t in (cap_edit or []):
            if a <= w["s"] < b:
                w["w"] = t
        if w["w"]:
            out.append(w)
    return out


def chunk_words(words, gap=CHUNK_GAP, max_words=CHUNK_WORDS, max_chars=CHUNK_CHARS):
    """Group words into caption chunks. max_chars None disables the character rule."""
    chunks, cur = [], []
    for w in words:
        if cur and (w["s"] - cur[-1]["e"] > gap or len(cur) >= max_words
                    or (max_chars is not None and sum(len(x["w"]) for x in cur) + len(w["w"]) > max_chars)
                    or re.search(r"[.!?]$", cur[-1]["w"])):
            chunks.append(cur)
            cur = []
        cur.append(w)
    if cur:
        chunks.append(cur)
    return chunks


def caption_word(w):
    """Display form: trailing comma or period dropped, upper case."""
    return re.sub(r"[,.]$", "", w).upper()


def translation(spec, lang):
    tr = spec.get("translations", {})
    if lang not in tr:
        raise ValueError("language %r has no entry in spec \"translations\" (have: %s)"
                         % (lang, ", ".join(sorted(tr)) or "none"))
    return tr[lang]


def positions(spec, layout=DEFAULT_LAYOUT):
    """(bar_y, cap_y, label_y) for the spec's layout, with spec overrides."""
    lay = spec.get("layout", "stack")
    if lay not in ("stack", "full"):
        raise ValueError("unknown layout %r (use \"stack\" or \"full\")" % lay)
    base = layout[lay]
    return (spec.get("bar_y", base["bar_y"]), spec.get("cap_y", base["cap_y"]), spec.get("lab_y", base["label_y"]))


def bar_text(spec, variant=None, lang=None):
    bar = spec["bar"]
    if variant and "bar" in spec.get("variants", {}).get(variant, {}):
        bar = spec["variants"][variant]["bar"]
    if lang:
        bar = translation(spec, lang).get("bar", bar)
    return bar


def burned_words(spec, words, variant=None):
    """The caption words as they are burned: the output-time words after the
    spec's fix map and cap_edit (a variant uses only its own cap_edit)."""
    cap_edit = spec["variants"][variant].get("cap_edit", []) if variant else spec.get("cap_edit", [])
    return apply_fixes(words, spec.get("fix", {}), cap_edit)


def build_ass(spec, words, variant=None, lang=None, layout=DEFAULT_LAYOUT, shots=None):
    """ASS text: title bar for the whole clip, labels, and word captions.

    With shots (the cutter's shot list) every label starts on the frame of a
    cut and ends on the frame of a later cut, whatever times were typed.

    With lang, the bar, labels and captions come from spec["translations"][lang]
    ({"bar", "caps": [[t0, t1, text]], "labels": {index or text: text}}) and the
    word captions are left out. With a variant, the variant's bar and only the
    variant's cap_edit apply.
    """
    W, H, CX = layout["width"], layout["height"], layout["center_x"]
    bar_y, cap_y, lab_y = positions(spec, layout)
    bar = bar_text(spec, variant, lang)
    font = spec.get("font", DEFAULT_FONT)
    colors = dict(DEFAULT_COLORS)
    colors.update({k: ass_color(v) for k, v in spec.get("colors", {}).items()})
    fs_bar = bar_font_size(bar)
    head = """[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,{F},74,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,0,0,0,0,100,100,0,0,1,7,3,5,70,200,0,1
Style: CapTr,{F},50,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,0,0,0,0,100,100,0,0,1,6,2,5,70,200,0,1
Style: Bar,{F},{FS},&H00000000,&H00000000,&H00FFFFFF,&H00FFFFFF,0,0,0,0,100,100,0,0,1,0,0,5,70,200,0,1
Style: Label,{F},50,&H00FFFFFF,&H00FFFFFF,&H001E1EE6,&H001E1EE6,0,0,0,0,100,100,0,0,3,12,0,5,70,200,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
""".format(W=W, H=H, F=font, FS=fs_bar)
    ev = ["Dialogue: 5,%s,%s,Bar,,0,0,0,,{\\pos(%d,%d)}" % (ass_time(0), ass_time(9999), CX, bar_y + layout["bar_h"] // 2)
          + ass_text(bar.upper())]
    tr = translation(spec, lang) if lang else None
    for i, (lb, t0, t1, f0, f1) in enumerate(placed_labels(spec, shots)):
        txt = lb["text"]
        if tr:
            labels = tr.get("labels", {})
            txt = labels.get(str(i), labels.get(lb["text"], txt))
        y = min(layout["label_max_y"], lb.get("y", lab_y))
        times = (ass_time(t0), ass_time(t1)) if f0 is None else (cut_time(f0), cut_time(f1))
        ev.append("Dialogue: 4,%s,%s,Label,,0,0,0,,{\\pos(%d,%d)}" % (times[0], times[1], CX, y)
                  + ass_text(txt))
    if tr:
        for t0, t1, txt in tr.get("caps", []):
            txt = "\n".join(textwrap.wrap(txt, TRANSLATION_WRAP))
            ev.append("Dialogue: 3,%s,%s,CapTr,,0,0,0,,{\\pos(%d,%d)}" % (ass_time(t0), ass_time(t1), CX, cap_y)
                      + ass_text(txt))
        return head + "\n".join(ev) + "\n"
    ws = burned_words(spec, words, variant)
    alt = spec.get("alt_words", [])
    chunks = chunk_words(ws)
    for ci, ch in enumerate(chunks):
        nxt = chunks[ci + 1][0]["s"] if ci + 1 < len(chunks) else 1e9
        for i, w in enumerate(ch):
            t0 = w["s"]
            t1 = ch[i + 1]["s"] if i + 1 < len(ch) else min(w["e"] + 0.3, nxt)
            if t1 <= t0:
                continue
            act = colors["alt"] if any(a <= w["s"] < b for a, b in alt) else colors["active"]
            txt = []
            for j, x in enumerate(ch):
                txt.append("{\\c%s}%s" % (act if j == i else WHITE, ass_text(caption_word(x["w"]))))
            ev.append("Dialogue: 3,%s,%s,Cap,,0,0,0,,{\\pos(%d,%d)}" % (ass_time(t0), ass_time(t1), CX, cap_y) + " ".join(txt))
    return head + "\n".join(ev) + "\n"


def load_words(path):
    """Word list from a Whisper-style JSON ({"segments": [{"words": [...]}]}) or a flat
    list of {"w", "s", "e"} (or {"word", "start", "end"})."""
    with open(path) as f:
        d = json.load(f)
    return normalize_words(d)


def normalize_words(d):
    if isinstance(d, dict):
        if "segments" in d:
            items = [w for s in d["segments"] for w in (s.get("words") or [])]
        elif "words" in d:
            items = d["words"]
        else:
            raise ValueError("word JSON has neither \"segments\" nor \"words\"")
    elif isinstance(d, list):
        items = d
    else:
        raise ValueError("word JSON must be an object or a list")
    out = []
    for w in items:
        if "w" in w:
            out.append({"w": str(w["w"]).strip(), "s": float(w["s"]), "e": float(w["e"])})
        else:
            out.append({"w": str(w["word"]).strip(), "s": float(w["start"]), "e": float(w["end"])})
    return [w for w in out if w["w"]]


def main(argv=None):
    ap = argparse.ArgumentParser(description="Write the ASS captions of a cut spec for an output-time word list.")
    ap.add_argument("spec")
    ap.add_argument("words")
    ap.add_argument("out")
    ap.add_argument("--variant")
    ap.add_argument("--lang")
    args = ap.parse_args(argv)
    try:
        with open(args.spec) as f:
            spec = json.load(f)
        text = build_ass(spec, load_words(args.words), args.variant, args.lang)
        with open(args.out, "w") as f:
            f.write(text)
    except (OSError, ValueError, KeyError) as e:
        print("captions: %s" % e, file=sys.stderr)
        return 1
    print(args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
