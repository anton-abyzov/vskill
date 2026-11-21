#!/usr/bin/env python3
"""Compare burned captions with an independent transcript of the master.

Usage:
    python3 caption_check.py <caption-words.json> <independent-words.json>
                             [--shots shots.json] [--max-ratio 0.08] [--json]

caption-words.json holds the words that were burned into the picture.
independent-words.json is a second transcript of the finished master's audio,
made by the reviewer with another engine or model. Both accept whisper JSON
(segments[].words), a list of {word|text, start, end} or {w, s, e}, or
{"words": [...]}.
An item whose text holds several words is split, with its time shared out
evenly.

Words are compared after lower-casing and dropping punctuation, aligned with
difflib.SequenceMatcher. Each difference is printed with its time:

- replaced: the captions show other words than the speech,
- missing from captions: spoken, not shown,
- extra in captions: shown, not spoken.

A difference that holds a number or a capitalised word (a name, a brand, a
model) is marked CHECK BY EAR: transcripts disagree most on exactly those, so
a person settles them by listening.

A difference is a question, not a fix. The independent transcript is a guess
from the sound as well, and it heard a short clip made of pieces. Change a
caption only when two models agree on the sentence in the source recording,
read with the words around it. Never change one from a burst of a few words,
or from a transcript that runs across a cut: there the model heard an ending
and a beginning that were never said together.

With --shots (the cutter's shots.json) each difference also gets the place in
the source recording to listen at, and AT A CUT when the sound jumps within
half a second of it.

The mismatch ratio is the number of words in differences over the number of
independent words. Exit 1 when it is over --max-ratio, 2 on an error.
"""
import argparse
import difflib
import json
import os
import re
import sys

_PUNCT = re.compile(r"[^\w]+", re.UNICODE)

NOTE = ("A difference is a question, not a fix: the second transcript is a guess from the sound too. "
        "Change a caption only when two models agree on the sentence in the source recording, with the "
        "words around it; never from a few isolated words or across a cut.")
CUT_NEAR = 0.5      # a difference this close to a jump in the sound is marked AT A CUT


def norm(word):
    """Lower case, punctuation removed. Pure."""
    return _PUNCT.sub("", word.lower()).replace("_", "")


def load_words(data):
    """Flatten word JSON to [{word, start, end}], splitting multi-word items. Pure."""
    if isinstance(data, dict):
        if "segments" in data:
            items = [w for s in data["segments"] for w in s.get("words", [])]
        else:
            items = data.get("words", [])
    else:
        items = data
    out = []
    for w in items:
        text = str(w.get("word", w.get("text", w.get("w", "")))).strip()
        start = float(w.get("start", w.get("s", 0.0)))
        end = float(w.get("end", w.get("e", start)))
        parts = text.split()
        if not parts:
            continue
        step = (end - start) / len(parts)
        for i, p in enumerate(parts):
            out.append({"word": p, "start": round(start + i * step, 3),
                        "end": round(start + (i + 1) * step, 3)})
    return [w for w in out if norm(w["word"])]


def mostly_upper(words):
    letters = [c for w in words for c in w["word"] if c.isalpha()]
    if not letters:
        return False
    return sum(1 for c in letters if c.isupper()) / float(len(letters)) > 0.8


def name_like(word, all_caps_source):
    """A number, or a capitalised word when the source is not all caps. Pure."""
    if any(c.isdigit() for c in word):
        return True
    if all_caps_source:
        return False
    letters = [c for c in word if c.isalpha()]
    return bool(letters) and letters[0].isupper()


def compare(caption_words, independent_words):
    """Differences between the two word lists. Pure.
    Returns (diffs, ratio). Each diff is a dict with kind, time, captions,
    spoken and check_by_ear."""
    a = [norm(w["word"]) for w in caption_words]
    b = [norm(w["word"]) for w in independent_words]
    cap_upper = mostly_upper(caption_words)
    ind_upper = mostly_upper(independent_words)
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    diffs = []
    wrong = 0
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        cap = caption_words[i1:i2]
        spk = independent_words[j1:j2]
        kind = {"replace": "replaced", "delete": "extra in captions",
                "insert": "missing from captions"}[tag]
        if spk:
            t = spk[0]["start"]
        elif cap:
            t = cap[0]["start"]
        else:
            t = 0.0
        ear = any(name_like(w["word"], cap_upper) for w in cap) or \
            any(name_like(w["word"], ind_upper) for w in spk)
        wrong += max(i2 - i1, j2 - j1)
        diffs.append({"kind": kind, "time": round(t, 2),
                      "captions": " ".join(w["word"] for w in cap),
                      "spoken": " ".join(w["word"] for w in spk),
                      "check_by_ear": ear})
    ratio = wrong / float(max(len(b), 1))
    return diffs, ratio


def sound_place(shot):
    """(source key, source time) where a shot's sound starts. Same rule as
    cutplan.audio_source: the sound follows "a_in" unless the shot has "g_in"."""
    if "a_in" in shot and "g_in" not in shot:
        return shot.get("a_src", shot.get("src")), shot["a_in"]
    return shot.get("src"), shot["in"]


def edits(shots):
    """Output times where the sound jumps: the joins between shots that do not
    carry on from each other in the source. Pure."""
    out = []
    for a, b in zip(shots, shots[1:]):
        ka, ta = sound_place(a)
        kb, tb = sound_place(b)
        if ka != kb or abs(ta + (a["out"] - a["in"]) - tb) > 0.02:
            out.append(b["t0"])
    return out


def locate(shots, t):
    """{"key", "time"} in the source for output time t, or None outside the cut. Pure."""
    for i, s in enumerate(shots):
        if s["t0"] <= t < s["t1"] or (i == len(shots) - 1 and t >= s["t0"]):
            key, start = sound_place(s)
            return {"key": key, "time": round(start + (t - s["t0"]) * s.get("speed", 1.0), 2)}
    return None


def place_diffs(diffs, shots, near=CUT_NEAR):
    """Add "source" and "at_cut" to each difference from the cutter's shot list. Pure."""
    jumps = edits(shots)
    for d in diffs:
        d["source"] = locate(shots, d["time"])
        d["at_cut"] = any(abs(d["time"] - j) <= near for j in jumps)
    return diffs


def format_diff(d):
    ear = "  CHECK BY EAR" if d["check_by_ear"] else ""
    if d.get("source"):
        ear += "  source %s@%.2f" % (d["source"]["key"], d["source"]["time"])
    if d.get("at_cut"):
        ear += "  AT A CUT"
    if d["kind"] == "replaced":
        body = "captions %r, spoken %r" % (d["captions"], d["spoken"])
    elif d["kind"] == "missing from captions":
        body = "spoken %r" % d["spoken"]
    else:
        body = "captions %r" % d["captions"]
    return "%7.2f  %-21s %s%s" % (d["time"], d["kind"], body, ear)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Burned captions against an independent transcript.")
    ap.add_argument("captions", help="words burned as captions (JSON)")
    ap.add_argument("independent", help="independent transcript of the master (JSON)")
    ap.add_argument("--shots", help="the cutter's shots.json: adds the source time of each difference")
    ap.add_argument("--max-ratio", type=float, default=0.08)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    try:
        with open(args.captions, encoding="utf-8") as fh:
            cap = load_words(json.load(fh))
        with open(args.independent, encoding="utf-8") as fh:
            ind = load_words(json.load(fh))
        shots = None
        if args.shots:
            with open(args.shots, encoding="utf-8") as fh:
                shots = json.load(fh)
            if not isinstance(shots, list) or not shots:
                raise ValueError("%s holds no shots" % os.path.basename(args.shots))
            for s in shots:
                float(s["in"]) + float(s["out"]) + float(s["t0"]) + float(s["t1"])
    except (OSError, ValueError, TypeError, AttributeError, KeyError) as exc:
        print("caption_check: cannot read word files: %s" % exc, file=sys.stderr)
        return 2
    if not ind:
        print("caption_check: the independent transcript has no words", file=sys.stderr)
        return 2
    diffs, ratio = compare(cap, ind)
    if shots:
        place_diffs(diffs, shots)
    over = ratio > args.max_ratio
    if args.json:
        print(json.dumps({"captions": os.path.basename(args.captions),
                          "independent": os.path.basename(args.independent),
                          "caption_words": len(cap), "independent_words": len(ind),
                          "ratio": round(ratio, 3), "max_ratio": args.max_ratio,
                          "ok": not over, "diffs": diffs, "note": NOTE}, indent=1, ensure_ascii=False))
    else:
        for d in diffs:
            print(format_diff(d))
        print("%d differences, mismatch ratio %.3f (max %.3f): %s" % (
            len(diffs), ratio, args.max_ratio, "FAIL" if over else "PASS"))
        if diffs:
            print(NOTE)
    return 1 if over else 0


if __name__ == "__main__":
    sys.exit(main())
