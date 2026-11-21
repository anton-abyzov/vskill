#!/usr/bin/env python3
"""Render one platform export from a finished master.

Usage:
    python3 export.py <master.mp4> --preset P1|P2|P3|P4|P5|P6|C1 --out <dir>
                      [--crop-y Y] [--cover-time S] [--fps-source]
                      [--duration S] [--fps FPS] [--presets presets.json]
                      [--dry-run] [--ffmpeg PATH] [--ffprobe PATH]

Presets (numbers in presets.json, sources in references/platform-specs.md):
- P1 master vertical 1080x1920 at the source frame rate.
- P2 720x1280 at 30 fps, the fallback where 1080p is not played.
- P3 1080x1350 (4:5). It crops the vertical master and never letterboxes.
  --crop-y sets the top of the crop window in master pixels; by default the
  window is centred on the text safe box (y 288 to 1248).
- P4 1920x1080 long form, from a 16:9 compilation.
- P5 size-capped for a 50 MB bot limit. Two-pass ABR with
  video kbps = (48 * 8000 / seconds) - 128, minus 5 percent. Under
  3,000 kbps it drops to 720x1280. 30 fps at most. Short clips are held
  at 8,000 kbps, the P1 rate at 30 fps, so the copy is never richer than the
  master.
- P6 size-capped 10 MB teaser at 720x1280 and 30 fps. Two-pass with
  video kbps = (9.5 * 8000 / seconds) - 96, minus 5 percent. Longer clips
  are trimmed to the first 30 s. Held at 5,000 kbps at most.
- C1 cover JPG 1080x1920 from one frame (--cover-time, default 1.0 s).

The source frame rate is kept (30 stays 30, 60 stays 60) except where a
preset sets 30 (P2, P6) or caps it at 30 (P5). --fps-source keeps the source
rate on those presets too. The duration and frame rate come from ffprobe;
--duration and --fps give them by hand, so --dry-run can run without
ffprobe.

Loudness is not re-normalised here. The master is already at -14 LUFS and
-1 dBTP; audio is only re-encoded to AAC. No watermark or logo is ever
burned into an export.

--dry-run prints the ffmpeg command(s) and renders nothing.
Exit code 0 on success, 1 when a render fails or overshoots its size cap,
2 on a usage error.
Environment: STS_FFMPEG and STS_FFPROBE name the binaries when the flags are
not given.
"""
import argparse
import json
import os
import shlex
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PRESETS = os.path.join(HERE, "presets.json")


def load_presets(path=DEFAULT_PRESETS):
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    common = data.get("common", {})
    out = {}
    for pid, p in data["presets"].items():
        q = dict(p)
        q["id"] = pid
        q["common"] = common
        out[pid] = q
    return out


def capped_kbps(seconds, cap_mb, audio_kbps, margin=0.05):
    """Video kbps that keeps a file of `seconds` under cap_mb (1 MB = 8000 kbit). Pure."""
    if seconds <= 0:
        raise ValueError("duration must be positive")
    kbps = (cap_mb * 8000.0 / seconds - audio_kbps) * (1.0 - margin)
    if kbps <= 0:
        raise ValueError("%.1f s does not fit in %s MB with %d kbps audio" % (seconds, cap_mb, audio_kbps))
    return kbps


def out_fps(preset, fps, keep_source=False):
    """Frame rate of the export. Pure."""
    if keep_source:
        return float(fps)
    want = preset.get("fps", "source")
    if want != "source":
        return float(want)
    if preset.get("max_fps"):
        return min(float(fps), float(preset["max_fps"]))
    return float(fps)


def _tier(preset, fps):
    video = preset["video"]
    if "any" in video:
        return video["any"]
    return video["60"] if fps > 30.5 else video["30"]


def crop_top(preset, crop_y=None, master_h=1920):
    """Top row of the 4:5 window in master pixels, clamped. Pure."""
    h = preset["height"]
    if crop_y is None:
        a, b = preset.get("safe_box_y", [288, 1248])
        crop_y = int(round((a + b) / 2.0 - h / 2.0))
    return max(0, min(int(crop_y), master_h - h))


def _fmt_fps(f):
    return str(int(f)) if float(f).is_integer() else "%.3f" % f


def build_command(preset, src, out, duration, fps, crop_y=None, cover_time=None,
                  ffmpeg="ffmpeg", passlog=None, keep_source_fps=False):
    """ffmpeg argv lists for one export (two lists for the two-pass presets). Pure."""
    kind = preset.get("kind", "video")
    common = preset.get("common", {})
    if kind == "image":
        t = preset.get("cover_time", 1.0) if cover_time is None else cover_time
        return [[ffmpeg, "-v", "error", "-y", "-ss", str(t), "-i", src, "-frames:v", "1",
                 "-vf", "scale=%d:%d:flags=lanczos" % (preset["width"], preset["height"]),
                 "-q:v", "2", out]]

    seconds = float(duration)
    trim = None
    mx = preset.get("max_seconds")
    if mx and seconds > mx + 0.05:
        if preset.get("trim_to_max"):
            trim, seconds = float(mx), float(mx)
        else:
            raise ValueError("clip is %.1f s; %s allows %d s" % (seconds, preset["id"], mx))

    fr = out_fps(preset, fps, keep_source_fps)
    gop = int(round(fr * common.get("gop_seconds", 2)))
    w, h = preset["width"], preset["height"]
    filters = []
    rate_args = []
    if kind == "capped":
        kbps = capped_kbps(seconds, preset["cap_mb"], preset["audio_kbps"], preset.get("margin", 0.05))
        if preset.get("max_kbps"):
            kbps = min(kbps, float(preset["max_kbps"]))
        fb = preset.get("fallback")
        if fb and kbps < fb["below_kbps"]:
            w, h = fb["width"], fb["height"]
        rate_args = ["-b:v", "%dk" % int(kbps)]
    else:
        tier = _tier(preset, fr)
        rate_args = ["-b:v", tier["bitrate"]]
        if "maxrate" in tier:
            rate_args += ["-maxrate", tier["maxrate"], "-bufsize", tier["bufsize"]]

    if preset.get("crop"):
        filters.append("scale=1080:1920:flags=lanczos")
        filters.append("crop=%d:%d:0:%d" % (w, h, crop_top(preset, crop_y)))
    else:
        filters.append("scale=%d:%d:flags=lanczos" % (w, h))
    if abs(fr - float(fps)) > 0.01:
        filters.append("fps=%s" % _fmt_fps(fr))
    filters.append("format=%s" % common.get("pix_fmt", "yuv420p"))

    color = common.get("color", "bt709")
    head = [ffmpeg, "-v", "error", "-y", "-i", src]
    if trim:
        head += ["-t", _fmt_fps(trim)]
    video = ["-map", "0:v:0", "-vf", ",".join(filters),
             "-c:v", common.get("vcodec", "libx264"), "-preset", common.get("x264_preset", "slow"),
             "-profile:v", common.get("profile", "high")]
    if preset.get("level"):
        video += ["-level", preset["level"]]
    video += rate_args + ["-bf", str(common.get("bframes", 2)), "-g", str(gop),
                          "-keyint_min", str(gop), "-sc_threshold", "0",
                          "-colorspace", color, "-color_primaries", color, "-color_trc", color]
    audio = ["-map", "0:a:0?", "-c:a", common.get("acodec", "aac"),
             "-b:a", "%dk" % preset["audio_kbps"], "-ar", str(common.get("audio_rate", 48000)),
             "-ac", str(common.get("audio_channels", 2))]
    tail = ["-movflags", "+faststart", out]

    if kind == "capped":
        log = passlog or (os.path.splitext(out)[0] + ".2pass")
        p1 = head + video + ["-pass", "1", "-passlogfile", log, "-an", "-f", "mp4", os.devnull]
        p2 = head + video + ["-pass", "2", "-passlogfile", log] + audio + tail
        return [p1, p2]
    return [head + video + audio + tail]


def probe(ffprobe, src):
    cmd = [ffprobe, "-v", "error", "-select_streams", "v:0",
           "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", src]
    try:
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except OSError as exc:
        raise RuntimeError("cannot run ffprobe (%s): %s" % (ffprobe, exc))
    if res.returncode != 0:
        raise RuntimeError("ffprobe could not read %s" % src)
    j = json.loads(res.stdout.decode("utf-8"))
    st = j["streams"][0]
    num, den = st["r_frame_rate"].split("/")
    return {"width": int(st["width"]), "height": int(st["height"]),
            "fps": float(num) / float(den), "duration": float(j["format"]["duration"])}


def aspect_problem(preset, width, height):
    """None when the master fits the preset, else a reason. Pure."""
    src = width / float(height)
    want = 16 / 9.0 if preset["width"] > preset["height"] else 9 / 16.0
    if abs(src - want) / want > 0.01:
        return ("master is %dx%d; %s needs a %s master (crop it upstream, never letterbox)"
                % (width, height, preset["id"], "16:9" if want > 1 else "9:16"))
    return None


def main(argv=None):
    ap = argparse.ArgumentParser(description="Render one platform export from a master.")
    ap.add_argument("master")
    ap.add_argument("--preset", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--crop-y", type=int, help="P3: top of the 4:5 window in master pixels")
    ap.add_argument("--cover-time", type=float, help="C1: frame time in seconds")
    ap.add_argument("--duration", type=float, help="skip ffprobe for the duration")
    ap.add_argument("--fps-source", action="store_true",
                    help="keep the source frame rate on presets that set or cap it at 30")
    ap.add_argument("--fps", type=float, help="source frame rate; skips ffprobe for it")
    ap.add_argument("--presets", default=DEFAULT_PRESETS)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--ffmpeg")
    ap.add_argument("--ffprobe")
    args = ap.parse_args(argv)

    try:
        presets = load_presets(args.presets)
    except (OSError, ValueError, KeyError) as exc:
        print("export: cannot read presets: %s" % exc, file=sys.stderr)
        return 2
    pid = args.preset.upper()
    if pid not in presets:
        print("export: unknown preset %s (have %s)" % (args.preset, ", ".join(sorted(presets))),
              file=sys.stderr)
        return 2
    preset = presets[pid]
    if not args.dry_run and not os.path.isfile(args.master):
        print("export: no such file: %s" % args.master, file=sys.stderr)
        return 2
    ffmpeg = args.ffmpeg or os.environ.get("STS_FFMPEG") or "ffmpeg"
    ffprobe = args.ffprobe or os.environ.get("STS_FFPROBE") or "ffprobe"

    info = {"duration": args.duration, "fps": args.fps}
    if info["duration"] is None or info["fps"] is None:
        try:
            p = probe(ffprobe, args.master)
        except (RuntimeError, ValueError, KeyError, IndexError) as exc:
            print("export: %s" % exc, file=sys.stderr)
            return 2
        problem = aspect_problem(preset, p["width"], p["height"])
        if problem:
            print("export: %s" % problem, file=sys.stderr)
            return 2
        info = {"duration": info["duration"] or p["duration"], "fps": info["fps"] or p["fps"]}

    stem = os.path.splitext(os.path.basename(args.master))[0]
    ext = ".jpg" if preset.get("kind") == "image" else ".mp4"
    out = os.path.join(args.out, "%s.%s%s" % (stem, pid, ext))
    try:
        cmds = build_command(preset, args.master, out, info["duration"], info["fps"],
                             crop_y=args.crop_y, cover_time=args.cover_time, ffmpeg=ffmpeg,
                             keep_source_fps=args.fps_source)
    except ValueError as exc:
        print("export: %s" % exc, file=sys.stderr)
        return 2
    mx_x = preset.get("max_seconds_x")
    if mx_x and info["duration"] > mx_x + 0.05:
        print("export: note: %.1f s is over the %d s limit of X; this file is for the other platforms %s serves"
              % (info["duration"], mx_x, pid), file=sys.stderr)
    if args.dry_run:
        for c in cmds:
            print(" ".join(shlex.quote(x) for x in c))
        return 0
    os.makedirs(args.out, exist_ok=True)
    for c in cmds:
        res = subprocess.run(c)
        if res.returncode != 0:
            print("export: ffmpeg failed on %s" % pid, file=sys.stderr)
            return 1
    log = os.path.splitext(out)[0] + ".2pass"
    for suffix in ("-0.log", "-0.log.mbtree"):
        if os.path.exists(log + suffix):
            os.remove(log + suffix)
    size_mb = os.path.getsize(out) / 1e6
    limit = preset.get("limit_mb")
    print("%s  %.2f MB" % (out, size_mb))
    if limit and size_mb > limit:
        print("export: %s is %.2f MB, over its %s MB limit" % (pid, size_mb, limit), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
