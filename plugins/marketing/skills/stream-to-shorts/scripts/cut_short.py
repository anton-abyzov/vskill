#!/usr/bin/env python3
"""Cut a vertical short from a long recording, burn captions, master the sound.

    cut_short.py plan   spec.json [--variant b] [--out DIR]
    cut_short.py render spec.json [--variant b] [--lang es] --out DIR [--words words.json]
    cut_short.py finish spec.json [--variant b] [--lang es] --out DIR

plan prints the shot list and crop windows. render cuts every shot, joins them
with the concat filter, gets caption words, then runs finish. finish burns the
title bar, captions and labels, cleans and normalises the sound to -14 LUFS and
writes the master and metrics.json. Run finish alone after editing the spec's
bar, labels, fix or cap_edit, or words.json: it reuses the cut.

A spec "bed" (a level in dBFS, about -55) lays quiet noise under the whole
clip. Use it when the stream's sound went through a noise gate: its pauses are
digital silence, the recording holds no room tone to fill them with, and each
one plays as a hole.

Files in DIR: <id>[-variant][-lang].mp4, shots[-variant].json,
words[-variant].json (caption words before fixes), burned[-variant].json (the
words as burned, after fix and cap_edit; what caption_check.py compares),
cap[-variant][-lang].ass, metrics[-variant][-lang].json, base[-variant].nut
(the cut before captions).

Options:
  --ffmpeg PATH         ffmpeg with the ass filter (default $STS_FFMPEG or ffmpeg)
  --ffprobe PATH        default $STS_FFPROBE or ffprobe
  --words FILE          caption words in output time (Whisper JSON or [{"w","s","e"}])
  --transcribe-cmd CMD  command run on the cut audio, with {wav} {outdir} {name}
                        {lang}; it must write {outdir}/{name}.json or
                        {outdir}/<wav stem>.json. Default $STS_TRANSCRIBE, else
                        mlx_whisper, else whisper, when on PATH. "off" disables it.
  --fontconfig FILE     FONTCONFIG_FILE for ffmpeg builds that need one

Caption words come from --words, else the transcribe command, else the spec's
source transcripts mapped through the shot timeline. metrics.json says which.

Exit codes: 0 done, 1 bad spec or failed tool, 2 bad arguments.
"""
import argparse
import json
import math
import os
import re
import shlex
import shutil
import subprocess
import sys

import captions
import cutplan


NAME_RX = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")

# The room-tone bed: pink noise with the top rolled off, the same every run,
# in stereo like the cut (its level is measured after that step, which is not
# free: one channel spread over two comes out quieter).
BED_NOISE = "anoisesrc=color=pink:seed=7:sample_rate=48000:duration=%.3f,lowpass=f=4000,aformat=channel_layouts=stereo"
BED_RANGE = (-80.0, -40.0)
LOUDNORM_RATE = 192000   # loudnorm hands on 192 kHz; the bed joins it at that rate, before the limiter


class CutError(Exception):
    pass


def tool_paths(args):
    ff = args.ffmpeg or os.environ.get("STS_FFMPEG") or "ffmpeg"
    fp = args.ffprobe or os.environ.get("STS_FFPROBE") or "ffprobe"
    return ff, fp


def run(cmd, what, cwd=None, env=None):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd, env=env, errors="replace")
    except OSError as e:
        raise CutError("%s: cannot run %s (%s)" % (what, cmd[0], e))
    if r.returncode != 0:
        lines = [x for x in r.stderr.strip().splitlines() if x.strip()]
        raise CutError("%s failed: %s" % (what, lines[-1] if lines else "exit %d" % r.returncode))
    return r


def has_filter(ffmpeg, name, env=None):
    try:
        r = subprocess.run([ffmpeg, "-hide_banner", "-filters"], capture_output=True, text=True, env=env, errors="replace")
    except OSError:
        return False
    return any(re.match(r"^\s*\S+\s+%s\s" % re.escape(name), line) for line in r.stdout.splitlines())


def preflight_ass(ffmpeg, env=None):
    if shutil.which(ffmpeg) is None and not os.path.isfile(ffmpeg):
        raise CutError("ffmpeg not found: %s (pass --ffmpeg or set STS_FFMPEG)" % ffmpeg)
    if not has_filter(ffmpeg, "ass", env):
        raise CutError("%s has no ass filter, so captions cannot be burned. Use an ffmpeg built with libass "
                       "(--enable-libass) through --ffmpeg or STS_FFMPEG; the binary bundled with the imageio-ffmpeg "
                       "Python package had it in a November 2026 check" % ffmpeg)


# Segment fields that are numbers: (field, test of the value, what the message says).
SEGMENT_NUMBERS = (
    ("a_in", lambda v: v >= 0, "a source time in seconds, 0 or more"),
    ("g_in", lambda v: v >= 0, "a source time in seconds, 0 or more"),
    ("vol", lambda v: v >= 0, "a volume factor, 0 or more"),
    ("z", lambda v: v > 0, "a zoom above 0"),
    ("punch", lambda v: v > 0, "a zoom above 0"),
    ("max_zoom", lambda v: v > 0, "a zoom cap above 0"),
    ("gap", lambda v: v >= 0, "a pause length in seconds, 0 or more"),
    ("face_dy", lambda v: True, "a number of pixels"),
)


def number(v):
    """True for a finite int or float; a bool is not a number here."""
    return not isinstance(v, bool) and isinstance(v, (int, float)) and math.isfinite(v)


def load_spec(path):
    try:
        with open(path) as f:
            spec = json.load(f)
    except (OSError, ValueError) as e:
        raise CutError("cannot read spec %s: %s" % (path, e))
    if not isinstance(spec, dict):
        raise CutError("spec %s must be a JSON object" % path)
    for field in ("sources", "transcripts"):
        group = spec.get(field, {})
        if not isinstance(group, dict) or not all(isinstance(v, str) for v in group.values()):
            raise CutError("spec \"%s\" must be an object of paths: {key: \"file\"}" % field)
    base = os.path.dirname(os.path.abspath(path))
    for field in ("sources", "transcripts"):
        spec[field] = {k: (v if os.path.isabs(os.path.expanduser(v)) else os.path.join(base, v))
                       for k, v in spec.get(field, {}).items()}
        spec[field] = {k: os.path.expanduser(v) for k, v in spec[field].items()}
    if not spec.get("id"):
        raise CutError("spec has no \"id\"")
    for field in ("variants", "translations"):
        group = spec.get(field, {})
        if not isinstance(group, dict) or not all(isinstance(v, dict) for v in group.values()):
            raise CutError("spec \"%s\" must be an object of objects: {name: {...}}" % field)
    # These become file names and part of an ffmpeg filter: plain names only.
    names = [("id", spec["id"])]
    names += [("variant name", k) for k in spec.get("variants", {})]
    names += [("language code", k) for k in spec.get("translations", {})]
    for what, v in names:
        if not isinstance(v, str) or not NAME_RX.match(v):
            raise CutError("spec %s %r: use letters, digits, dot, dash and underscore only" % (what, v))
    bars = [("bar", spec.get("bar"))]
    bars += [("variants.%s.bar" % k, v["bar"]) for k, v in spec.get("variants", {}).items() if "bar" in v]
    bars += [("translations.%s.bar" % k, v["bar"]) for k, v in spec.get("translations", {}).items() if "bar" in v]
    for what, v in bars:
        if not isinstance(v, str) or not v.strip():
            raise CutError("spec \"%s\" (the title bar text) is missing or empty" % what)
    groups = [("segments", spec.get("segments"))]
    groups += [("variants.%s.segments" % k, v["segments"]) for k, v in spec.get("variants", {}).items() if "segments" in v]
    for name, segs in groups:
        if not isinstance(segs, list) or not segs:
            raise CutError("spec %s must be a non-empty list" % name)
        for i, seg in enumerate(segs):
            try:
                if not (number(seg["in"]) and number(seg["out"])):
                    raise ValueError
                ok = seg["out"] > seg["in"]
            except (KeyError, TypeError, ValueError):
                raise CutError("%s[%d] needs numeric \"in\" and \"out\"" % (name, i))
            if seg["in"] < 0:
                raise CutError("%s[%d]: \"in\" must be 0 or more" % (name, i))
            if not ok:
                raise CutError("%s[%d]: \"out\" must be after \"in\"" % (name, i))
            sp = seg.get("speed", 1.0)
            if isinstance(sp, bool) or not isinstance(sp, (int, float)) or not math.isfinite(sp) or sp <= 0:
                raise CutError("%s[%d]: \"speed\" must be a number above 0" % (name, i))
            for key, ok, rule in SEGMENT_NUMBERS:
                if key in seg and not (number(seg[key]) and ok(seg[key])):
                    raise CutError("%s[%d]: \"%s\" must be %s" % (name, i, key, rule))
            if seg.get("gate") not in (None, False, 0) and (not number(seg["gate"]) or not 0 < seg["gate"] <= 1):
                raise CutError("%s[%d]: \"gate\" must be a threshold above 0 and up to 1" % (name, i))
            if "g_in" in seg and seg.get("layout", spec.get("layout", "stack")) == "full":
                raise CutError("%s[%d]: \"g_in\" moves the screen panel of the stack layout; a \"full\" segment "
                               "has one picture, so set its \"in\"" % (name, i))
    limit = spec.get("shot")
    if limit is not None and (not number(limit) or limit <= 0):
        raise CutError("spec \"shot\" (the longest shot in seconds) must be a number above 0")
    if "punch" in spec and not (number(spec["punch"]) and spec["punch"] > 0):
        raise CutError("spec \"punch\" must be a zoom above 0")
    labels = spec.get("labels", [])
    if not isinstance(labels, list):
        raise CutError("spec \"labels\" must be a list: [{\"at\": 1.2, \"dur\": 1.4, \"text\": \"...\"}]")
    for i, lb in enumerate(labels):
        if not isinstance(lb, dict):
            raise CutError("labels[%d] must be an object with \"at\", \"dur\" and \"text\"" % i)
        if not isinstance(lb.get("text"), str) or not lb["text"].strip():
            raise CutError("labels[%d] needs a \"text\"" % i)
        if not number(lb.get("at")) or lb["at"] < 0:
            raise CutError("labels[%d]: \"at\" must be a time in seconds, 0 or more" % i)
        if not number(lb.get("dur")) or lb["dur"] <= 0:
            raise CutError("labels[%d]: \"dur\" must be a length in seconds above 0" % i)
        if "y" in lb and not number(lb["y"]):
            raise CutError("labels[%d]: \"y\" must be a number of pixels" % i)
    bed = spec.get("bed")
    if bed is not None and (isinstance(bed, bool) or not isinstance(bed, (int, float)) or not math.isfinite(bed)
                            or not BED_RANGE[0] <= bed <= BED_RANGE[1]):
        raise CutError("spec \"bed\" must be a level in dBFS between %d and %d (about -55)" % BED_RANGE)
    if not spec.get("sources"):
        raise CutError("spec has no \"sources\": {key: path}")
    if "src" not in spec:
        if len(spec["sources"]) == 1:
            spec["src"] = next(iter(spec["sources"]))
        else:
            raise CutError("spec has several sources and no default \"src\"")
    return spec


class Transcripts(object):
    """Source transcripts named in the spec, loaded on first use."""

    def __init__(self, spec):
        self.paths = spec.get("transcripts", {})
        self.cache = {}

    def has(self, key):
        return key in self.paths

    def words(self, key):
        if key not in self.cache:
            if key not in self.paths:
                raise CutError("no transcript for source %r: add \"transcripts\": {\"%s\": \"words.json\"} to the spec" % (key, key))
            try:
                self.cache[key] = captions.load_words(self.paths[key])
            except (OSError, ValueError, KeyError) as e:
                raise CutError("cannot read transcript %s: %s" % (self.paths[key], e))
        return self.cache[key]

    def window(self, key, a, b):
        return cutplan.words_in_window(self.words(key), a, b)


def plan_shots(spec, variant, transcripts):
    try:
        shots = cutplan.timeline(cutplan.expand_shots(spec, variant, transcripts.window))
    except cutplan.PlanError as e:
        raise CutError(str(e))
    for s in shots:
        for key in (s["src"], s.get("a_src", s["src"])):
            if key not in spec["sources"]:
                raise CutError("shot at %.2f uses source %r, which is not in spec \"sources\"" % (s["in"], key))
    return shots


def probe_size(ffprobe, path):
    r = run([ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", path],
            "ffprobe " + os.path.basename(path))
    st = json.loads(r.stdout)["streams"][0]
    return int(st["width"]), int(st["height"])


def probe_duration(ffprobe, path):
    """Length of a base cut in seconds: its picture frames, counted, over FPS.

    The container's own duration is not used. A NUT file with B-frames starts
    a few hundredths after 0 and reports that offset as length, so a 90-frame
    cut reads 3.053 s; the closing fade then starts after the sound has ended.
    """
    r = run([ffprobe, "-v", "error", "-select_streams", "v:0", "-count_packets",
             "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", path], "ffprobe frame count")
    try:
        return int(r.stdout.strip().strip(",")) / float(cutplan.FPS)
    except ValueError:
        raise CutError("ffprobe gave no frame count for %s" % os.path.basename(path))


def probe_length(ffprobe, path):
    """Length of a source in seconds from its container, or None when it has none."""
    try:
        r = subprocess.run([ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                           capture_output=True, text=True, errors="replace")
        v = float(r.stdout.strip().strip(","))
    except (OSError, ValueError):
        return None
    return v if math.isfinite(v) and v > 0 else None


# Intermediate files are encoded without B-frames, so they start at time 0.
INTERMEDIATE = ["-c:v", "libx264", "-bf", "0", "-preset", "veryfast", "-pix_fmt", "yuv420p"]


def tags(variant, lang):
    return ("-" + variant if variant else ""), ("-" + lang if lang else "")


def build(spec, shots, outdir, variant, ff, fp, env):
    """Render each shot to an intermediate file, then join them with the concat filter."""
    sizes = {}
    layout_name = spec.get("layout", "stack")
    parts = []
    for line in past_end_warnings(spec, shots, fp):
        print(line)
    for i, s in enumerate(shots):
        src_key = s["src"]
        src = spec["sources"][src_key]
        if src_key not in sizes:
            if not os.path.exists(src):
                raise CutError("source %r not found: %s" % (src_key, src))
            sizes[src_key] = probe_size(fp, src)
        sw, sh = sizes[src_key]
        try:
            vf = cutplan.shot_video_filter(s, layout_name, sw, sh, spec.get("facecam"))
        except cutplan.PlanError as e:
            raise CutError(str(e))
        vf += cutplan.SHOT_VIDEO_OUT
        af = cutplan.shot_audio_filter(s)
        ain = []
        if "g_in" in s:
            ain = ["-ss", "%.3f" % s["g_in"], "-t", "%.3f" % cutplan.read_length(s), "-i", src]
        elif "a_in" in s:
            ain = ["-ss", "%.3f" % s["a_in"], "-t", "%.3f" % cutplan.read_length(s), "-i", spec["sources"][s.get("a_src", src_key)]]
        p = os.path.join(outdir, "shot%03d.nut" % i)
        run([ff, "-v", "error", "-y", "-ss", "%.3f" % s["in"], "-t", "%.3f" % cutplan.read_length(s), "-i", src] + ain
            + ["-filter_complex", vf + ";" + af, "-map", "[v2]", "-map", "[a2]", "-r", str(cutplan.FPS)]
            + frame_limit(s) + INTERMEDIATE
            + ["-crf", "12", "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", "-f", "nut", p],
            "ffmpeg shot %d" % i, env=env)
        parts.append(p)
    tagv, _ = tags(variant, None)
    base = os.path.join(outdir, "base%s.nut" % tagv)
    ins = []
    for p in parts:
        ins += ["-i", p]
    fc = "".join("[%d:v][%d:a]" % (i, i) for i in range(len(parts))) + "concat=n=%d:v=1:a=1[v][a]" % len(parts)
    run([ff, "-v", "error", "-y"] + ins + ["-filter_complex", fc, "-map", "[v]", "-map", "[a]"] + INTERMEDIATE
        + ["-crf", "12", "-c:a", "pcm_s16le", "-f", "nut", base],
        "ffmpeg concat", env=env)
    for p in parts:
        os.remove(p)
    with open(os.path.join(outdir, "shots%s.json" % tagv), "w") as f:
        json.dump(shots, f, indent=1)
    return base


def frame_limit(shot):
    """Output options that stop a shot's picture at its planned frame count.
    cutplan.shot_grid already gives exactly that many frames and
    cutplan.shot_audio_filter the matching sound; this is the second lock."""
    return ["-frames:v", str(shot["frames"])] if "frames" in shot else []


def past_end_warnings(spec, shots, ffprobe):
    """A WARN line for every shot that reads past the end of its source.
    A shot that starts past the end has nothing to render and stops the run."""
    keys = set()
    for s in shots:
        keys.update((s["src"], s.get("a_src", s["src"])))
    lengths = {k: probe_length(ffprobe, spec["sources"][k]) for k in keys if os.path.exists(spec["sources"][k])}
    out = []
    for r in cutplan.past_end(shots, lengths):
        s = r["shot"]
        where = "the shot at %.2f-%.2f" % (s["in"], s["out"])
        if r["field"] != "in":
            where += " (its \"%s\", %.2f-%.2f)" % (r["field"], r["start"], r["end"])
        if r["nothing"]:
            raise CutError("%s starts past the end of source %r (%.2f s), or within %.1f s of it, where there may "
                           "be no frame to show: fix its times" % (where, r["key"], r["have"], cutplan.SOURCE_EDGE))
        fix = "\"in\" and \"out\"" if r["field"] == "in" else "\"%s\" or its length" % r["field"]
        out.append("WARN %s reads past the end of source %r (%.2f s): it holds the last frame over silence there. "
                   "Fix its %s" % (where, r["key"], r["have"], fix))
    return out


def bed_gain(ff, level, env):
    """Gain in dB that puts the bed noise at `level` dBFS RMS. Measured, since
    noise sources are not equally loud in every ffmpeg build."""
    try:
        r = subprocess.run([ff, "-hide_banner", "-nostats", "-f", "lavfi", "-i", BED_NOISE % 5.0,
                            "-af", "volumedetect", "-f", "null", "-"],
                           capture_output=True, text=True, env=env, errors="replace")
    except OSError as e:
        raise CutError("cannot run %s (%s)" % (ff, e))
    m = re.search(r"mean_volume:\s*(-?[\d.]+) dB", r.stderr)
    if not m:
        raise CutError("could not measure the noise bed: this ffmpeg needs the anoisesrc and volumedetect filters")
    return level - float(m.group(1))


def audio_args(ff, bed, chain, tail, dur, env):
    """(extra inputs, audio options) for the finishing pass. chain is the
    clean-up and loudness part, tail the limiter and the closing fade; the bed
    is mixed in between, so the limiter sees it."""
    if bed is None:
        return [], ["-af", chain + "," + tail]
    fc = ("[0:a]%s[m];[1:a]volume=%.2fdB,aresample=%d[b];"
          "[m][b]amix=inputs=2:duration=first:normalize=0,%s[a]"
          % (chain, bed_gain(ff, bed, env), LOUDNORM_RATE, tail))
    return (["-f", "lavfi", "-i", BED_NOISE % (dur + 1.0)],
            ["-filter_complex", fc, "-map", "0:v", "-map", "[a]"])


def default_transcribe_cmd():
    if shutil.which("mlx_whisper"):
        return ("mlx_whisper {wav} --model mlx-community/whisper-large-v3-turbo --language {lang} "
                "--word-timestamps True --condition-on-previous-text False --output-format json "
                "--output-dir {outdir} --output-name {name} --verbose False")
    if shutil.which("whisper"):
        return ("whisper {wav} --model turbo --language {lang} --word_timestamps True "
                "--output_format json --output_dir {outdir}")
    return None


def transcribe(template, wav, outdir, name, lang):
    fields = {"wav": wav, "outdir": outdir, "name": name, "lang": lang}
    cmd = [tok.format(**fields) for tok in shlex.split(template)]
    run(cmd, "transcribe command")
    stem = os.path.splitext(os.path.basename(wav))[0]
    for cand in (os.path.join(outdir, name + ".json"), os.path.join(outdir, stem + ".json")):
        if os.path.exists(cand):
            return captions.load_words(cand)
    raise CutError("transcribe command wrote no %s.json or %s.json in %s" % (name, stem, outdir))


def caption_words(spec, shots, base, outdir, variant, args, ff, transcripts, env):
    """(words in output time, how they were found)."""
    if args.words:
        try:
            return captions.load_words(args.words), "words-file"
        except (OSError, ValueError, KeyError) as e:
            raise CutError("cannot read --words %s: %s" % (args.words, e))
    template = args.transcribe_cmd or os.environ.get("STS_TRANSCRIBE") or default_transcribe_cmd()
    if template and template.strip().lower() not in ("off", "none", "no"):
        tagv, _ = tags(variant, None)
        wav = os.path.join(outdir, "base%s.wav" % tagv)
        run([ff, "-v", "error", "-y", "-i", base, "-ac", "1", "-ar", "16000", wav], "ffmpeg audio for transcription", env=env)
        try:
            ws = transcribe(template, wav, outdir, "transcript" + tagv, spec.get("language", "en"))
            return [dict(w, s=round(w["s"], 2), e=round(w["e"], 2)) for w in ws], "transcribed"
        except CutError as e:
            print("WARN %s; using the source transcripts instead" % e)
        finally:
            if os.path.exists(wav):
                os.remove(wav)
    keys = set(cutplan.audio_source(s)[0] for s in shots)
    missing = [k for k in sorted(keys) if not transcripts.has(k)]
    if missing:
        raise CutError("no caption words: pass --words, a working --transcribe-cmd, or spec \"transcripts\" for %s"
                       % ", ".join(missing))
    return cutplan.map_words({k: transcripts.words(k) for k in keys}, shots), "source-transcript"


def loudness(ff, path, env):
    r = subprocess.run([ff, "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True, env=env, errors="replace").stderr
    tail = r[r.rfind("Summary:"):]

    def g(k):
        m = re.search(k + r":\s+(-?[\d.]+)", tail)
        if not m:
            raise CutError("could not read %s from the ebur128 summary" % k)
        return float(m.group(1))
    return {"I": g("I"), "LRA": g("LRA"), "TP": g("Peak")}


def check_measured(measured, dur):
    """Stop when the first loudness pass could not measure the cut: under
    about half a second of sound, or digital silence, reads as -inf, and the
    second pass then fails with a message about nothing."""
    if "inf" in str(measured.get("input_i")).lower():
        raise CutError("the loudness of the cut cannot be measured: it is %.2f s long and needs at least half a "
                       "second of sound that is not silent" % dur)


# What the second loudnorm pass accepts for each value of the first.
LOUDNORM_RANGES = (("input_i", -99.0, 0.0), ("input_tp", -99.0, 99.0), ("input_lra", 0.0, 99.0),
                   ("input_thresh", -99.0, 0.0), ("target_offset", -99.0, 99.0))


def loudnorm_pass2(measured, dur):
    """The second-pass loudnorm filter from the first pass's measurement.

    The filter refuses a measurement outside its own ranges, and a clipped or
    over-boosted cut measures above 0 LUFS. Each value is held inside its
    range, and such a cut gets a WARN: it is still brought down by the pass
    and the limiter, from a start that is a little too low.
    """
    check_measured(measured, dur)
    vals = []
    for key, low, high in LOUDNORM_RANGES:
        try:
            v = float(measured[key])
        except (KeyError, TypeError, ValueError):
            raise CutError("loudnorm first pass gave no %s" % key)
        vals.append(measured[key] if low <= v <= high else ("%.2f" % min(high, max(low, v))))
    if float(measured["input_i"]) > 0:
        print("WARN the cut measures %.1f LUFS, louder than full scale: the source is clipped or \"vol\" is too "
              "high. Lower \"vol\" and listen to the master" % float(measured["input_i"]))
    return ("loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=%s:measured_TP=%s:measured_LRA=%s:measured_thresh=%s:offset=%s"
            ":linear=false" % tuple(vals))


def label_report(spec, shots, lang=None):
    """The labels as placed, for metrics.json: each with the text that was
    burned (the translation with `lang`), the times it was typed with and the
    cut times it got. "shown" is false for a label typed past the end of the
    cut, which is left out."""
    tr = captions.translation(spec, lang) if lang else None
    return [{"text": captions.label_text(lb, i, tr), "at": t0, "end": t1,
             "typed_at": lb["at"], "typed_end": round(lb["at"] + lb["dur"], 3),
             "on_cuts": f0 is not None, "shown": t0 is not None}
            for i, (lb, t0, t1, f0, _) in enumerate(captions.placed_labels(spec, shots))]


def metrics_for(out, dur, shots, words, ff, env):
    longest = max(s["t1"] - s["t0"] for s in shots) if shots else 0
    gaps = [(round(a["e"], 2), round(b["s"], 2)) for a, b in zip(words, words[1:]) if b["s"] - a["e"] > 0.6]
    return {"file": os.path.basename(out), "duration_s": round(dur, 2), "shots": len(shots),
            "longest_shot": round(longest, 2),
            "first_change_s": round(shots[0]["t1"], 2) if len(shots) > 1 else None,
            "cuts_per_min": round((len(shots) - 1) / dur * 60, 1) if dur else 0,
            "first_word_s": words[0]["s"] if words else None, "words": len(words),
            "wpm": round(len(words) / dur * 60) if dur else 0, "speech_gaps_over_0.6": gaps,
            "loudness": loudness(ff, out, env), "size_mb": round(os.path.getsize(out) / 1e6, 1)}


def finish(spec, outdir, variant, lang, ff, fp, env, words_source=None):
    tagv, tagl = tags(variant, lang)
    base = os.path.join(outdir, "base%s.nut" % tagv)
    for p in (base, os.path.join(outdir, "shots%s.json" % tagv), os.path.join(outdir, "words%s.json" % tagv)):
        if not os.path.exists(p):
            raise CutError("%s is missing: run render first" % p)
    with open(os.path.join(outdir, "shots%s.json" % tagv)) as f:
        shots = json.load(f)
    with open(os.path.join(outdir, "words%s.json" % tagv)) as f:
        words = json.load(f)
    ass_name = "cap%s%s.ass" % (tagv, tagl)
    try:
        text = captions.build_ass(spec, words, variant, lang, shots=shots)
        labels = label_report(spec, shots, lang)
    except (ValueError, KeyError, TypeError) as e:
        raise CutError("captions: %s" % e)
    with open(os.path.join(outdir, ass_name), "w") as f:
        f.write(text)
    if not lang:
        with open(os.path.join(outdir, "burned%s.json" % tagv), "w") as f:
            json.dump(captions.burned_words(spec, words, variant), f, indent=0)
    bar_y = captions.positions(spec)[0]
    lay = cutplan.DEFAULT_LAYOUT
    dur = probe_duration(fp, base)
    pre = "highpass=f=70,afftdn=nr=8:nf=-45"
    m = subprocess.run([ff, "-hide_banner", "-nostats", "-i", base, "-af",
                        pre + ",loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True, env=env, errors="replace").stderr
    try:
        j = json.loads(m[m.rfind("{"):m.rfind("}") + 1])
    except ValueError:
        raise CutError("loudnorm first pass gave no measurement")
    ln = loudnorm_pass2(j, dur)
    out_name = "%s%s%s.mp4" % (spec["id"], tagv, tagl)
    out = os.path.join(outdir, out_name)
    vf = "drawbox=x=0:y=%d:w=%d:h=%d:color=white:t=fill,ass=%s" % (bar_y, lay["width"], lay["bar_h"], ass_name)
    extra, audio = audio_args(ff, spec.get("bed"), "%s,%s" % (pre, ln),
                              "alimiter=limit=0.89:level=false,afade=t=out:st=%.2f:d=0.05" % max(0.0, dur - 0.05),
                              dur, env)
    run([ff, "-v", "error", "-y", "-i", os.path.basename(base)] + extra + ["-vf", vf] + audio
        + ["-c:v", "libx264", "-profile:v", "high", "-level", "4.2", "-crf", "17", "-maxrate", "12M", "-bufsize", "24M",
           "-preset", "slow", "-pix_fmt", "yuv420p", "-r", "30", "-g", "60",
           "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-movflags", "+faststart", out_name],
        "ffmpeg finish", cwd=outdir, env=env)
    met = metrics_for(out, dur, shots, words, ff, env)
    met["bed_dbfs"] = spec.get("bed")
    met["labels"] = labels
    cuts = cutplan.cut_frames(shots)
    met["planned_s"] = round(cuts[-1] / float(cutplan.FPS), 3) if cuts else None
    mpath = os.path.join(outdir, "metrics%s%s.json" % (tagv, tagl))
    for prev in (mpath, os.path.join(outdir, "metrics%s.json" % tagv)):
        if words_source is None and os.path.exists(prev):
            try:
                with open(prev) as f:
                    words_source = json.load(f).get("words_source")
            except (OSError, ValueError):
                pass
    met["words_source"] = words_source
    with open(mpath, "w") as f:
        json.dump(met, f, indent=1)
    print(json.dumps(met))
    print(" ".join("%s[%s]" % (w["w"], w["s"]) for w in words))
    limit = spec.get("shot", lay["max_shot"])
    if met["first_word_s"] is not None and met["first_word_s"] > 0.2:
        print("WARN first word at %.2f s: the clip opens on silence (target 0.2 s or less)" % met["first_word_s"])
    if met["first_word_s"] is None:
        print("WARN no caption words")
    if met["longest_shot"] > limit + 0.05:
        print("WARN longest shot %.2f s is over the %.2f s limit" % (met["longest_shot"], limit))
    if met["planned_s"] is not None and abs(dur - met["planned_s"]) > 0.5 / cutplan.FPS:
        print("WARN the cut is %.3f s long and the plan %.3f s: a shot is off the frame grid, so cuts and labels "
              "have drifted. Render again" % (dur, met["planned_s"]))
    for lb in met["labels"]:
        if not lb["shown"]:
            print("NOTE label %r is typed at %.2f s, past the end of this cut, and is left out"
                  % (lb["text"], lb["typed_at"]))
        elif not lb["on_cuts"]:
            print("WARN label %r is not on a cut: this shot list has no frame counts. Render again" % lb["text"])
        elif max(abs(lb["at"] - lb["typed_at"]), abs(lb["end"] - lb["typed_end"])) > 2.5 / cutplan.FPS:
            print("NOTE label %r was typed %.2f-%.2f and sits on the cuts at %.2f-%.2f: check it is the right shot"
                  % (lb["text"], lb["typed_at"], lb["typed_end"], lb["at"], lb["end"]))
    return met


def cmd_plan(spec, args, ff, fp):
    shots = plan_shots(spec, args.variant, Transcripts(spec))
    sizes = {}
    for s in shots:
        size = sizes.get(s["src"])
        if size is None and s["src"] not in sizes:
            try:
                size = probe_size(fp, spec["sources"][s["src"]])
            except CutError:
                size = None
            sizes[s["src"]] = size
        line = "%6.2f %5.2f  %s %.2f-%.2f z%s" % (s["t0"], s["t1"] - s["t0"], s["src"], s["in"], s["out"], s["z"])
        if size:
            try:
                win = cutplan.shot_windows(s, spec.get("layout", "stack"), size[0], size[1], spec.get("facecam"))
            except cutplan.PlanError as e:
                raise CutError(str(e))
            line += "  screen %s" % (list(win["screen"]),)
            if win["face"]:
                line += " face %s" % (list(win["face"]),)
        print(line)
    if not all(sizes.values()):
        print("note: windows not shown for sources ffprobe could not read")
    if args.out:
        os.makedirs(args.out, exist_ok=True)
        tagv, _ = tags(args.variant, None)
        with open(os.path.join(args.out, "plan%s.json" % tagv), "w") as f:
            json.dump(shots, f, indent=1)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Cut a vertical short from a cut spec.",
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    ap.add_argument("command", choices=["plan", "render", "finish"])
    ap.add_argument("spec")
    ap.add_argument("--variant")
    ap.add_argument("--lang", help="translation language code from spec \"translations\"")
    ap.add_argument("--out", help="output folder")
    ap.add_argument("--ffmpeg")
    ap.add_argument("--ffprobe")
    ap.add_argument("--transcribe-cmd")
    ap.add_argument("--words")
    ap.add_argument("--fontconfig")
    args = ap.parse_args(argv)
    ff, fp = tool_paths(args)
    env = dict(os.environ)
    if args.fontconfig:
        env["FONTCONFIG_FILE"] = os.path.abspath(args.fontconfig)
    try:
        spec = load_spec(args.spec)
        if args.variant:
            cutplan.segments_for(spec, args.variant)
        if args.lang:
            captions.translation(spec, args.lang)
        if args.command == "plan":
            cmd_plan(spec, args, ff, fp)
            return 0
        if not args.out:
            raise CutError("--out is required for %s" % args.command)
        outdir = os.path.abspath(args.out)
        os.makedirs(outdir, exist_ok=True)
        preflight_ass(ff, env)
        if args.command == "render":
            transcripts = Transcripts(spec)
            shots = plan_shots(spec, args.variant, transcripts)
            if not shots:
                raise CutError("the spec gives no shots")
            base = build(spec, shots, outdir, args.variant, ff, fp, env)
            words, how = caption_words(spec, shots, base, outdir, args.variant, args, ff, transcripts, env)
            tagv, _ = tags(args.variant, None)
            with open(os.path.join(outdir, "words%s.json" % tagv), "w") as f:
                json.dump(words, f, indent=0)
            print("caption words: %s (%d)" % (how, len(words)))
            finish(spec, outdir, args.variant, args.lang, ff, fp, env, words_source=how)
        else:
            finish(spec, outdir, args.variant, args.lang, ff, fp, env)
    except CutError as e:
        print("cut_short: %s" % e, file=sys.stderr)
        return 1
    except cutplan.PlanError as e:
        print("cut_short: %s" % e, file=sys.stderr)
        return 1
    except (OSError, ValueError, KeyError, TypeError) as e:
        print("cut_short: %s: %s" % (type(e).__name__, e), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
