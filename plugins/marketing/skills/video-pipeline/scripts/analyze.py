#!/usr/bin/env python3
"""Measure a video before anyone edits it, or measure a reference video's pacing.

Writes <out>/analysis.json with stream facts, loudness, silences, speech spans,
shots and pacing numbers. Optional: evenly spaced frames to look at, and a
word-level transcript. Needs ffmpeg and ffprobe; --transcribe needs the
openai-whisper CLI (`whisper`). Standard library only.

  python3 analyze.py take.mp4 --out .work
  python3 analyze.py take.mp4 --out .work --screencast --frames 24 --transcribe
  python3 analyze.py reference.mp4 --out .work/reference --frames 12
"""
import argparse
import json
import os
import re
import shutil
import statistics
import subprocess
import sys


def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True, errors="replace")
    return p.returncode, p.stdout, p.stderr


def need(tool):
    if not shutil.which(tool):
        sys.exit(f"analyze: {tool} not found on PATH")


def probe(src):
    code, out, err = run(["ffprobe", "-v", "error", "-print_format", "json",
                          "-show_format", "-show_streams", src])
    if code != 0:
        sys.exit(f"analyze: ffprobe failed: {err.strip()}")
    data = json.loads(out)
    info = {"duration_s": round(float(data["format"].get("duration", 0)), 3),
            "size_bytes": int(data["format"].get("size", 0)),
            "video": None, "audio": None}
    for s in data.get("streams", []):
        if s.get("codec_type") == "video" and (s.get("disposition") or {}).get("attached_pic"):
            continue  # cover art in an audio file is not a video stream
        if s.get("codec_type") == "video" and info["video"] is None:
            num, _, den = (s.get("avg_frame_rate") or "0/1").partition("/")
            fps = float(num) / float(den) if float(den or 0) else 0.0
            info["video"] = {"codec": s.get("codec_name"), "width": s.get("width"),
                             "height": s.get("height"), "fps": round(fps, 3),
                             "duration_s": round(float(s.get("duration", 0) or 0), 3)}
        if s.get("codec_type") == "audio" and info["audio"] is None:
            info["audio"] = {"codec": s.get("codec_name"),
                             "sample_rate": int(s.get("sample_rate", 0) or 0),
                             "channels": s.get("channels"),
                             "duration_s": round(float(s.get("duration", 0) or 0), 3)}
    return info


def loudness(src):
    _, _, err = run(["ffmpeg", "-hide_banner", "-nostats", "-i", src, "-vn",
                     "-af", "ebur128=peak=true", "-f", "null", "-"])
    tail = err[err.rfind("Summary:"):] if "Summary:" in err else ""
    def grab(pattern):
        m = re.search(pattern, tail)
        return float(m.group(1)) if m else None
    return {"integrated_lufs": grab(r"I:\s+(-?[\d.]+) LUFS"),
            "range_lu": grab(r"LRA:\s+(-?[\d.]+) LU"),
            "true_peak_dbfs": grab(r"Peak:\s+(-?[\d.]+) dBFS")}


def silences(src, noise_db, min_s, duration):
    _, _, err = run(["ffmpeg", "-hide_banner", "-nostats", "-i", src, "-vn",
                     "-af", f"silencedetect=noise={noise_db}dB:d={min_s}",
                     "-f", "null", "-"])
    starts = [float(x) for x in re.findall(r"silence_start: (-?[\d.]+)", err)]
    ends = [float(x) for x in re.findall(r"silence_end: (-?[\d.]+)", err)]
    out = []
    for i, s in enumerate(starts):
        e = ends[i] if i < len(ends) else duration
        out.append({"start": round(max(s, 0.0), 3), "end": round(min(e, duration), 3)})
    return out


def invert(spans, duration):
    out, cursor = [], 0.0
    for s in spans:
        if s["start"] - cursor > 0.05:
            out.append({"start": round(cursor, 3), "end": s["start"]})
        cursor = max(cursor, s["end"])
    if duration - cursor > 0.05:
        out.append({"start": round(cursor, 3), "end": round(duration, 3)})
    return out


def shots(src, threshold, duration):
    _, _, err = run(["ffmpeg", "-hide_banner", "-nostats", "-i", src, "-an",
                     "-vf", f"scale=320:-2,select='gt(scene,{threshold})',showinfo",
                     "-f", "null", "-"])
    cuts = sorted({round(float(x), 3) for x in re.findall(r"pts_time:([\d.]+)", err)})
    edges = [0.0] + [c for c in cuts if 0.0 < c < duration] + [round(duration, 3)]
    return [{"start": a, "end": b} for a, b in zip(edges, edges[1:]) if b - a > 0]


def frames(src, out_dir, count, duration, width, notes):
    fdir = os.path.join(out_dir, "frames")
    os.makedirs(fdir, exist_ok=True)
    made = []
    for i in range(count):
        t = duration * (i + 0.5) / count
        path = os.path.join(fdir, f"f{i + 1:03d}_{t:08.2f}s.jpg")
        code, _, _ = run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                          "-ss", f"{t:.3f}", "-i", src, "-frames:v", "1",
                          "-vf", f"scale={width}:-2", "-q:v", "4", path])
        if code == 0 and os.path.exists(path):
            made.append({"t": round(t, 2), "path": path})
    if len(made) < count:
        notes.append(f"frames: saved {len(made)} of {count}")
    return made


def transcribe(src, out_dir, model, language):
    if not shutil.which("whisper"):
        return {"skipped": "whisper CLI not found; install openai-whisper or transcribe another way"}
    if language and language.lower() not in ("en", "english") and model.endswith(".en"):
        model = model[:-3]  # an English-only model would transcribe other languages as English
    wav = os.path.join(out_dir, "source.wav")
    code, _, err = run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", src,
                        "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav])
    if code != 0:
        return {"skipped": f"audio extract failed: {err.strip()[-200:]}"}
    cmd = ["whisper", wav, "--model", model, "--word_timestamps", "True",
           "--output_format", "json", "--output_dir", out_dir]
    if language:
        cmd += ["--language", language]
    code, _, err = run(cmd)
    path = os.path.join(out_dir, "source.json")
    if code != 0 or not os.path.exists(path):
        return {"skipped": f"whisper failed: {err.strip()[-200:]}"}
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    words = [w for seg in data.get("segments", []) for w in seg.get("words", [])]
    return {"path": path, "model": model, "language": data.get("language"),
            "segments": len(data.get("segments", [])), "words": len(words)}


def pacing(info, shot_list, silence_list, transcript):
    duration = info["duration_s"] or 0.0
    lengths = [s["end"] - s["start"] for s in shot_list]
    silent = sum(s["end"] - s["start"] for s in silence_list)
    minutes = duration / 60 if duration else 0
    out = {"shots": len(lengths),
           "cuts_per_min": round((len(lengths) - 1) / minutes, 2) if minutes and lengths else None,
           "shot_median_s": round(statistics.median(lengths), 2) if lengths else None,
           "shot_mean_s": round(statistics.fmean(lengths), 2) if lengths else None,
           "shot_min_s": round(min(lengths), 2) if lengths else None,
           "shot_max_s": round(max(lengths), 2) if lengths else None,
           "first_cut_s": shot_list[0]["end"] if len(shot_list) > 1 else None,
           "silence_ratio": round(silent / duration, 3) if duration else None}
    words = (transcript or {}).get("words")
    spoken = duration - silent
    if words and spoken > 0:
        out["words_per_min_spoken"] = round(words / (spoken / 60), 1)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("source")
    ap.add_argument("--out", default=".work", help="output folder (default .work)")
    ap.add_argument("--screencast", action="store_true",
                    help="screen recording: scene threshold 0.05 instead of 0.3")
    ap.add_argument("--scene-threshold", type=float, default=None)
    ap.add_argument("--silence-db", type=float, default=-30.0)
    ap.add_argument("--silence-min", type=float, default=1.2, help="seconds (default 1.2)")
    ap.add_argument("--frames", type=int, default=0, help="evenly spaced frames to save")
    ap.add_argument("--frame-width", type=int, default=960,
                    help="saved frame width; use the source width to read small text")
    ap.add_argument("--transcribe", action="store_true", help="word timestamps via whisper")
    ap.add_argument("--model", default="base.en")
    ap.add_argument("--language", default=None)
    args = ap.parse_args()

    need("ffmpeg")
    need("ffprobe")
    if not os.path.isfile(args.source):
        sys.exit(f"analyze: no such file: {args.source}")
    os.makedirs(args.out, exist_ok=True)
    threshold = args.scene_threshold if args.scene_threshold is not None else (
        0.05 if args.screencast else 0.3)

    info = probe(args.source)
    duration = info["duration_s"]
    result = {"source": os.path.abspath(args.source), **info,
              "settings": {"scene_threshold": threshold, "silence_db": args.silence_db,
                           "silence_min_s": args.silence_min}}
    notes = []
    if info["audio"]:
        result["loudness"] = loudness(args.source)
        result["silences"] = silences(args.source, args.silence_db, args.silence_min, duration)
        adur = info["audio"]["duration_s"]
        if adur and duration - adur > 0.05:  # no audio after the track ends: that is silence
            sil = [s for s in result["silences"] if s["start"] < adur]
            if sil and sil[-1]["end"] >= adur - 0.05:
                sil[-1]["end"] = round(duration, 3)
            else:
                sil.append({"start": round(adur, 3), "end": round(duration, 3)})
            result["silences"] = sil
        result["speech_spans"] = invert(result["silences"], duration)
        if info["video"]:
            vdur = info["video"]["duration_s"]
            if vdur and adur:
                if abs(vdur - adur) > 0.05:
                    notes.append(f"audio and video streams differ by {abs(vdur - adur):.2f} s")
            else:
                notes.append("container gives no per-stream durations; audio/video length not compared")
        if result["loudness"]["integrated_lufs"] is None:
            notes.append("loudness not measurable (silent or too short)")
    else:
        result["silences"], result["speech_spans"] = [], []
        notes.append("no audio stream")
    result["shots"] = shots(args.source, threshold, duration) if info["video"] else []
    if not info["video"]:
        notes.append("no video stream")
    result["frames"] = frames(args.source, args.out, args.frames, duration,
                              args.frame_width, notes) \
        if args.frames > 0 and info["video"] else []
    result["transcript"] = transcribe(args.source, args.out, args.model, args.language) \
        if args.transcribe and info["audio"] else None
    if result["transcript"] and result["transcript"].get("skipped"):
        notes.append("transcript: " + result["transcript"]["skipped"])
    result["pacing"] = pacing(info, result["shots"], result["silences"], result["transcript"])
    result["notes"] = notes

    path = os.path.join(args.out, "analysis.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2)
    p, loud = result["pacing"], result.get("loudness") or {}
    print(f"analysis: {path}")
    print(f"duration {duration:.1f} s | shots {p['shots']} | median shot {p['shot_median_s']} s"
          f" | cuts/min {p['cuts_per_min']} | silence {p['silence_ratio']}"
          f" | {loud.get('integrated_lufs')} LUFS, peak {loud.get('true_peak_dbfs')} dBFS")
    for n in notes:
        print(f"note: {n}")


if __name__ == "__main__":
    main()
