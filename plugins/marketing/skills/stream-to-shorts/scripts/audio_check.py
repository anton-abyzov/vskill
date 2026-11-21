#!/usr/bin/env python3
"""Measure the audio of a finished short and check it against the targets.

Usage:
    python3 audio_check.py <video> [--words words.json] [--json]
                           [--silence-db -45] [--silence-min 0.5]
                           [--rate 48000] [--ffmpeg PATH]

What it measures:
- integrated loudness, true peak and loudness range (ffmpeg loudnorm,
  print_format=json; nothing is changed),
- silences (silencedetect, default -45 dB for 0.5 s or longer),
- peak level and clipped samples, from 16-bit mono PCM decoded through an
  ffmpeg pipe,
- RMS in 50 ms windows.

With --words (a word-level transcript of this file: whisper JSON with
segments[].words, a list of {word, start, end} or {w, s, e}, or
{"words": [...]}) it adds:
first word time, words a minute, gaps between words over 0.5 s, and every
word that has a 50 ms window below -50 dBFS inside it. That dip usually means
a cut or a noise gate clipped the word. Listen to each one.

It also lists dropouts: stretches of 0.2 s or longer near digital silence
(under -70 dBFS) with sound on both sides. Room tone never gets that quiet,
so a dropout is a hole left by a cut, a gate or a separated voice stem, and it
plays as a glitch, not as a pause. An independent check of the source run
found these on clips whose loudness numbers were all in range. A stream whose
sound went through a noise gate has one in every pause, and no room tone
anywhere to fill it with: give the cut spec a "bed" (see cut_short.py). A bed
at -55 dBFS keeps every pause above the -70 dBFS line this check uses.

Verdicts:
- loudness -14 LUFS plus or minus 1: FAIL outside
- true peak at or below -1 dBFS: FAIL above
- clipped samples: FAIL when any
- first word at or before 0.2 s: WARN after
- pauses inside speech: CHECK over 0.35 s, WARN over 0.5 s (the cut leaves
  0.3 s; 0.35 s is the cap, one and a half frames of room for word timings)
- silences, dropouts and dipped words: WARN

Exit code 1 when any verdict is FAIL, 2 on an error, 0 otherwise.
Environment: STS_FFMPEG names the ffmpeg binary when --ffmpeg is not given.
"""
import argparse
import array
import json
import math
import os
import re
import subprocess
import sys

TARGET_LUFS = -14.0
LUFS_TOLERANCE = 1.0
MAX_TRUE_PEAK = -1.0
MAX_FIRST_WORD = 0.2
PAUSE_CHECK = 0.35
PAUSE_WARN = 0.5
DIP_DB = -50.0
DROPOUT_DB = -70.0
DROPOUT_MIN = 0.2
DROPOUT_CONTEXT_DB = -50.0
WINDOW = 0.05
CLIP_LEVEL = 32735  # 0.999 of full scale for 16-bit


# ---- pure parts ------------------------------------------------------------

def rms_windows(samples, rate, window=WINDOW):
    """dBFS RMS of consecutive windows of 16-bit samples. Pure."""
    k = max(1, int(round(rate * window)))
    out = []
    for i in range(0, len(samples) - k + 1, k):
        acc = 0
        for x in samples[i:i + k]:
            acc += x * x
        r = math.sqrt(acc / float(k)) / 32768.0
        out.append(20.0 * math.log10(r + 1e-9))
    return out


def peak_stats(samples, clip_level=CLIP_LEVEL):
    """(peak dBFS, clipped sample count). Pure."""
    if not len(samples):
        return -180.0, 0
    peak = max(abs(min(samples)), abs(max(samples)))
    clipped = sum(1 for x in samples if x >= clip_level or x <= -clip_level - 1)
    return 20.0 * math.log10(peak / 32768.0 + 1e-9), clipped


def dipped_words(words, rms, window=WINDOW, floor_db=DIP_DB):
    """Words with a window below floor_db inside them. Pure.
    Returns [(word, start, min_db)]."""
    hits = []
    for w in words:
        a = int(w["start"] / window)
        b = int(w["end"] / window)
        seg = rms[a:b + 1]
        if seg and min(seg) < floor_db:
            hits.append((w["word"], round(w["start"], 2), round(min(seg), 1)))
    return hits


def dropouts(rms, window=WINDOW, floor_db=DROPOUT_DB, min_s=DROPOUT_MIN,
             context_db=DROPOUT_CONTEXT_DB, context_s=0.5):
    """Stretches near digital silence with sound on both sides. Pure.
    Returns [(start, end, min_db)]. Silence that runs to the start or the end
    of the file is not a dropout (silencedetect reports those)."""
    out = []
    n = len(rms)
    ctx = max(1, int(round(context_s / window)))
    i = 0
    while i < n:
        if rms[i] >= floor_db:
            i += 1
            continue
        j = i
        while j < n and rms[j] < floor_db:
            j += 1
        before = rms[max(0, i - ctx):i]
        after = rms[j:j + ctx]
        if ((j - i) * window >= min_s - 1e-9 and before and after
                and max(before) > context_db and max(after) > context_db):
            out.append((round(i * window, 2), round(j * window, 2), round(min(rms[i:j]), 1)))
        i = j
    return out


def word_gaps(words, over=PAUSE_CHECK):
    """[(end_of_word, start_of_next, gap)] for gaps longer than over. Pure."""
    out = []
    for prev, nxt in zip(words, words[1:]):
        gap = nxt["start"] - prev["end"]
        if gap > over:
            out.append((round(prev["end"], 2), round(nxt["start"], 2), round(gap, 2)))
    return out


def speech_stats(words):
    """first word, last word end, words a minute over the speech span. Pure."""
    if not words:
        return None
    span = words[-1]["end"] - words[0]["start"]
    wpm = len(words) / (span / 60.0) if span > 0 else 0.0
    return {"first_word": round(words[0]["start"], 2), "last_word_end": round(words[-1]["end"], 2),
            "words": len(words), "wpm": round(wpm, 1)}


def normalise_words(data):
    """Flatten the common word-level JSON shapes to [{word, start, end}]. Pure."""
    if isinstance(data, dict):
        if "segments" in data:
            items = [w for s in data["segments"] for w in s.get("words", [])]
        else:
            items = data.get("words", [])
    else:
        items = data
    out = []
    for w in items:
        text = w.get("word", w.get("text", w.get("w", "")))
        start, end = w.get("start", w.get("s")), w.get("end", w.get("e"))
        if start is None or end is None:
            continue
        out.append({"word": str(text).strip(), "start": float(start), "end": float(end)})
    out.sort(key=lambda w: w["start"])
    return out


def verdicts(m):
    """Verdict lines from a metrics dict. Pure. Returns [(level, text)]."""
    v = []
    lufs = m.get("lufs")
    if lufs is not None:
        ok = abs(lufs - TARGET_LUFS) <= LUFS_TOLERANCE
        v.append(("PASS" if ok else "FAIL",
                  "integrated %.1f LUFS (target %.0f +/- %.0f)" % (lufs, TARGET_LUFS, LUFS_TOLERANCE)))
    tp = m.get("true_peak")
    if tp is not None:
        v.append(("PASS" if tp <= MAX_TRUE_PEAK else "FAIL",
                  "true peak %.1f dBTP (max %.0f)" % (tp, MAX_TRUE_PEAK)))
    clipped = m.get("clipped")
    if clipped is not None:
        v.append(("PASS" if clipped == 0 else "FAIL", "clipped samples %d" % clipped))
    if m.get("silences"):
        v.append(("WARN", "%d silence(s): %s" % (len(m["silences"]), ", ".join(
            "%.2f-%.2f" % (a, b) for a, b in m["silences"]))))
    if m.get("dropouts"):
        v.append(("WARN", "%d dropout(s) near digital silence (listen): %s" % (
            len(m["dropouts"]), ", ".join("%.2f-%.2f" % (a, b) for a, b, _ in m["dropouts"]))))
    elif "dropouts" in m:
        v.append(("PASS", "no dropout under %.0f dBFS" % DROPOUT_DB))
    sp = m.get("speech")
    if sp:
        fw = sp["first_word"]
        v.append(("PASS" if fw <= MAX_FIRST_WORD else "WARN",
                  "first word at %.2f s (max %.1f)" % (fw, MAX_FIRST_WORD)))
        gaps = m.get("gaps", [])
        long_gaps = [g for g in gaps if g[2] > PAUSE_WARN]
        mid_gaps = [g for g in gaps if PAUSE_CHECK < g[2] <= PAUSE_WARN]
        if long_gaps:
            v.append(("WARN", "pauses over %.1f s: %s" % (PAUSE_WARN, ", ".join(
                "%.2f-%.2f" % (a, b) for a, b, _ in long_gaps))))
        if mid_gaps:
            v.append(("CHECK", "pauses over %.2f s: %s" % (PAUSE_CHECK, ", ".join(
                "%.2f-%.2f" % (a, b) for a, b, _ in mid_gaps))))
        if not gaps:
            v.append(("PASS", "no pause over %.2f s inside speech" % PAUSE_CHECK))
        dips = m.get("dipped", [])
        if dips:
            v.append(("WARN", "words with a 50 ms window under %.0f dBFS (listen): %s" % (
                DIP_DB, ", ".join("%s@%.2f(%.0f)" % d for d in dips))))
        else:
            v.append(("PASS", "no word dips under %.0f dBFS" % DIP_DB))
    return v


# ---- ffmpeg ----------------------------------------------------------------

def _stderr(cmd):
    try:
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except OSError as exc:
        raise RuntimeError("cannot run %s: %s" % (cmd[0], exc))
    return res.returncode, res.stderr.decode("utf-8", "replace")


def loudness(ffmpeg, video):
    code, err = _stderr([ffmpeg, "-hide_banner", "-nostats", "-i", video, "-vn",
                         "-af", "loudnorm=print_format=json", "-f", "null", "-"])
    if code != 0 or "{" not in err:
        raise RuntimeError("loudnorm pass failed (does the file have audio?)")
    j = json.loads(err[err.rindex("{"):err.rindex("}") + 1])
    return float(j["input_i"]), float(j["input_tp"]), float(j["input_lra"])


def silences(ffmpeg, video, db, dur):
    code, err = _stderr([ffmpeg, "-hide_banner", "-nostats", "-i", video, "-vn",
                         "-af", "silencedetect=n=%sdB:d=%s" % (db, dur), "-f", "null", "-"])
    starts = [float(x) for x in re.findall(r"silence_start: (-?[\d.]+)", err)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", err)]
    out = []
    for i, s in enumerate(starts):
        e = ends[i] if i < len(ends) else None
        out.append((round(max(s, 0.0), 2), round(e, 2) if e is not None else -1.0))
    return out


def pcm(ffmpeg, video, rate):
    cmd = [ffmpeg, "-v", "error", "-i", video, "-vn", "-ac", "1", "-ar", str(rate),
           "-f", "s16le", "-acodec", "pcm_s16le", "-"]
    try:
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except OSError as exc:
        raise RuntimeError("cannot run ffmpeg: %s" % exc)
    if res.returncode != 0:
        raise RuntimeError("could not decode audio")
    data = res.stdout
    a = array.array("h")
    a.frombytes(data[:len(data) - len(data) % 2])
    if sys.byteorder == "big":
        a.byteswap()
    return a


def main(argv=None):
    ap = argparse.ArgumentParser(description="Check the audio of a finished short.")
    ap.add_argument("video")
    ap.add_argument("--words", help="word-level transcript JSON of this file")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--silence-db", type=float, default=-45.0)
    ap.add_argument("--silence-min", type=float, default=0.5)
    ap.add_argument("--rate", type=int, default=48000, help="PCM rate for peak and RMS")
    ap.add_argument("--ffmpeg", help="ffmpeg binary (default STS_FFMPEG or ffmpeg)")
    args = ap.parse_args(argv)

    if not os.path.isfile(args.video):
        print("audio_check: no such file: %s" % args.video, file=sys.stderr)
        return 2
    ffmpeg = args.ffmpeg or os.environ.get("STS_FFMPEG") or "ffmpeg"
    try:
        words = []
        if args.words:
            with open(args.words, encoding="utf-8") as fh:
                words = normalise_words(json.load(fh))
            if not words:
                raise ValueError("no timed words in %s" % os.path.basename(args.words))
        lufs, tp, lra = loudness(ffmpeg, args.video)
        sil = silences(ffmpeg, args.video, args.silence_db, args.silence_min)
        samples = pcm(ffmpeg, args.video, args.rate)
    except (RuntimeError, OSError, ValueError, KeyError) as exc:
        print("audio_check: %s" % exc, file=sys.stderr)
        return 2
    peak, clipped = peak_stats(samples)
    rms = rms_windows(samples, args.rate)
    m = {"file": os.path.basename(args.video), "duration": round(len(samples) / float(args.rate), 2),
         "lufs": lufs, "true_peak": tp, "lra": lra, "peak_dbfs": round(peak, 2),
         "clipped": clipped, "silences": sil, "dropouts": dropouts(rms)}
    if words:
        m["speech"] = speech_stats(words)
        m["gaps"] = word_gaps(words, PAUSE_CHECK)
        m["dipped"] = dipped_words(words, rms)
    v = verdicts(m)
    m["verdicts"] = [{"level": a, "text": b} for a, b in v]
    if args.json:
        m["rms_50ms"] = [round(x, 1) for x in rms]
        print(json.dumps(m, indent=1, ensure_ascii=False))
    else:
        print("%s  %.2f s  I %.1f LUFS  TP %.1f dBTP  LRA %.1f LU  peak %.1f dBFS  clipped %d"
              % (m["file"], m["duration"], lufs, tp, lra, peak, clipped))
        if words:
            s = m["speech"]
            print("words %d  first %.2f s  %.0f words/min" % (s["words"], s["first_word"], s["wpm"]))
        for level, text in v:
            print("%-5s %s" % (level, text))
    return 1 if any(level == "FAIL" for level, _ in v) else 0


if __name__ == "__main__":
    sys.exit(main())
