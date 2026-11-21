#!/usr/bin/env python3
"""Read a word-level transcript: windows of word timings, and keyword hits.

    words.py transcript.json 600-660 4200-4230
    words.py transcript.json --grep 'limit,ran out,rate*'
    words.py transcript.json --grep limit --context 12

The transcript is Whisper JSON ({"segments": [{"start", "end", "words": [...]}]})
or a flat list of {"w", "s", "e"}. A window a-b prints every segment that
touches it, one line per segment, with the time of every fourth word. Flat
lists are split into lines at pauses over 1 s or every 20 words.

--grep prints every hit of the given terms, one per line: time, term, and the
words around it (--context words on each side, default 8). Terms are
comma-separated and case-insensitive; punctuation is ignored; a term with
spaces matches a phrase; a trailing * matches a prefix. Use it for the census
(what happens where in a long stream) and for mining moments.

Exit 0 on success (also when nothing matches), 1 on an unreadable file,
2 on bad arguments.
"""
import argparse
import json
import re
import sys


def load(path):
    """Segments [{"start", "end", "words": [{"w", "s", "e"}]}] from either format."""
    with open(path) as f:
        d = json.load(f)
    if isinstance(d, dict) and "segments" in d:
        segs = []
        for s in d["segments"]:
            ws = [{"w": x["word"].strip(), "s": float(x["start"]), "e": float(x["end"])}
                  for x in (s.get("words") or [])]
            segs.append({"start": float(s["start"]), "end": float(s["end"]), "words": ws})
        return segs
    if isinstance(d, dict) and "words" in d:
        d = d["words"]
    if not isinstance(d, list):
        raise ValueError("expected Whisper JSON or a list of words")
    ws = []
    for x in d:
        if "w" in x:
            ws.append({"w": str(x["w"]).strip(), "s": float(x["s"]), "e": float(x["e"])})
        else:
            ws.append({"w": str(x["word"]).strip(), "s": float(x["start"]), "e": float(x["end"])})
    segs, cur = [], []
    for w in ws:
        if cur and (w["s"] - cur[-1]["e"] > 1.0 or len(cur) >= 20):
            segs.append(cur)
            cur = []
        cur.append(w)
    if cur:
        segs.append(cur)
    return [{"start": c[0]["s"], "end": c[-1]["e"], "words": c} for c in segs]


def window_lines(segs, a, b):
    lines = ["== %.0f-%.0f" % (a, b)]
    for s in segs:
        if s["end"] < a or s["start"] > b:
            continue
        lines.append("%.1f-%.1f: " % (s["start"], s["end"])
                     + " ".join("%s[%.1f]" % (x["w"], x["s"]) if i % 4 == 0 else x["w"] for i, x in enumerate(s["words"])))
    return lines


def norm(w):
    return re.sub(r"[^\w']+", "", w.lower())


def term_match(term, word):
    if term.endswith("*"):
        return word.startswith(term[:-1])
    return word == term


def grep(segs, terms, context=8):
    """Hits [(time, term, context text)] in time order."""
    ws = [w for s in segs for w in s["words"]]
    keys = [norm(w["w"]) for w in ws]
    hits = []
    for term in terms:
        parts = [p for p in (norm(x) if not x.endswith("*") else norm(x[:-1]) + "*" for x in term.split()) if p and p != "*"]
        if not parts:
            continue
        n = len(parts)
        for i in range(len(ws) - n + 1):
            if all(term_match(parts[k], keys[i + k]) for k in range(n)):
                lo, hi = max(0, i - context), min(len(ws), i + n + context)
                text = " ".join(("[%s]" % ws[j]["w"]) if i <= j < i + n else ws[j]["w"] for j in range(lo, hi))
                hits.append((ws[i]["s"], term, text))
    hits.sort(key=lambda h: h[0])
    return hits


def fmt_time(t):
    return "%d:%02d:%05.2f" % (t // 3600, t % 3600 // 60, t % 60)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Print word timings in windows and keyword hits.",
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    ap.add_argument("transcript")
    ap.add_argument("windows", nargs="*", help="a-b in seconds")
    ap.add_argument("--grep", help="comma-separated terms")
    ap.add_argument("--context", type=int, default=8)
    args = ap.parse_args(argv)
    wins = []
    for w in args.windows:
        try:
            a, b = map(float, w.split("-"))
        except ValueError:
            ap.error("window %r is not a-b in seconds" % w)
        wins.append((a, b))
    if not wins and not args.grep:
        ap.error("give at least one window a-b or --grep")
    try:
        segs = load(args.transcript)
    except (OSError, ValueError, KeyError, TypeError) as e:
        print("words: cannot read %s: %s" % (args.transcript, e), file=sys.stderr)
        return 1
    for a, b in wins:
        print("\n".join(window_lines(segs, a, b)))
    if args.grep:
        terms = [t.strip() for t in args.grep.split(",") if t.strip()]
        hits = grep(segs, terms, args.context)
        for t, term, text in hits:
            print("%8.2f  %s  %-12s %s" % (t, fmt_time(t), term, text))
        print("%d hits" % len(hits))
    return 0


if __name__ == "__main__":
    sys.exit(main())
