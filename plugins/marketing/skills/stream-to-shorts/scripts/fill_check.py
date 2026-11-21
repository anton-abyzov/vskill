#!/usr/bin/env python3
"""Flag the "empty bottom" reject on a vertical render.

Usage:
    python3 fill_check.py <video> [--times 0.1,1,2,3,5] [--json]
                          [--threshold 2.0] [--empty-band 0.07] [--min-ratio 0.15]
                          [--ffmpeg PATH]

The reject: a screen panel that is letterboxed inside a 1080x1920 frame and
leaves the bottom of the frame as a black or blurred fill. Safe zones limit
where text goes. They do not ask for an empty picture.

How it works. ffmpeg decodes a few frames as 270x480 grayscale raw video
through a pipe. For each row the script takes the mean absolute difference
between neighbouring pixels (row detail), then the maximum of that over the
sampled frames. The content floor is the lowest row that still has detail in
at least two adjacent rows. The render fails when:

- the rows below the content floor cover the bottom --empty-band of the
  frame or more (default 7 percent), or
- the mean detail of the bottom third is under --min-ratio (default 0.15)
  of the mean detail of the middle third.

A flat screen still passes when anything reaches the bottom edge: a white
app window with a dock, a caption bar, a game HUD. The defaults were tuned
on one production run: 12 first renders with a letterboxed panel (content
floor 66 to 89 percent of the height) and 32 fixed renders (97 to 100
percent).

This is a hint, not a verdict. Keep it next to the contact sheet and look
at the frames yourself.

Exit code 0 on PASS, 1 on FAIL, 2 on a usage or decode error.
Environment: STS_FFMPEG names the ffmpeg binary when --ffmpeg is not given.
"""
import argparse
import json
import os
import subprocess
import sys

WIDTH = 270
HEIGHT = 480


def row_detail(buf, width, height):
    """Mean absolute horizontal difference per row of one gray frame."""
    out = []
    for y in range(height):
        row = buf[y * width:(y + 1) * width]
        total = 0
        prev = row[0]
        for px in row[1:]:
            total += abs(px - prev)
            prev = px
        out.append(total / float(width - 1))
    return out


def merge_max(profiles):
    """Row-wise maximum over several row-detail profiles."""
    profiles = [p for p in profiles if p]
    if not profiles:
        return []
    return [max(vals) for vals in zip(*profiles)]


def content_floor(rows_detail, threshold=2.0, run=2):
    """Index of the lowest row whose detail and the detail of the run-1 rows
    above it are all at or over threshold. -1 when no row qualifies."""
    n = len(rows_detail)
    for y in range(n - 1, run - 2, -1):
        if all(rows_detail[y - k] >= threshold for k in range(run)):
            return y
    return -1


def _mean(vals):
    return sum(vals) / float(len(vals)) if vals else 0.0


def verdict(rows_detail, threshold=2.0, empty_band=0.07, min_ratio=0.15, run=2):
    """Judge one merged profile. Returns a dict with ok, floor_pct,
    empty_pct, bottom_ratio and reason."""
    n = len(rows_detail)
    if n < 3:
        raise ValueError("profile needs at least 3 rows")
    floor = content_floor(rows_detail, threshold, run)
    floor_pct = 100.0 * (floor + 1) / n if floor >= 0 else 0.0
    empty_pct = 100.0 - floor_pct
    third = n // 3
    panel = _mean(rows_detail[third:2 * third])
    bottom = _mean(rows_detail[2 * third:])
    ratio = bottom / panel if panel > 0 else (1.0 if bottom > 0 else 0.0)
    reasons = []
    if empty_pct >= 100.0 * empty_band:
        reasons.append("bottom %.1f%% of the frame has no detail in any sampled frame "
                       "(limit %.0f%%)" % (empty_pct, 100.0 * empty_band))
    if ratio < min_ratio:
        reasons.append("bottom third detail is %.2f of the middle third (limit %.2f)"
                       % (ratio, min_ratio))
    return {
        "ok": not reasons,
        "floor_row": floor,
        "floor_pct": round(floor_pct, 1),
        "empty_pct": round(empty_pct, 1),
        "bottom_ratio": round(ratio, 2),
        "reason": "; ".join(reasons) if reasons else "picture reaches the bottom edge",
    }


def tool_path(flag, env, default):
    return flag or os.environ.get(env) or default


def decode_gray(ffmpeg, video, t, width=WIDTH, height=HEIGHT):
    """One frame at time t as width*height bytes of gray, or None past the end."""
    cmd = [ffmpeg, "-v", "error", "-ss", str(t), "-i", video, "-frames:v", "1",
           "-vf", "scale=%d:%d,format=gray" % (width, height),
           "-f", "rawvideo", "-"]
    try:
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except OSError as exc:
        raise RuntimeError("cannot run ffmpeg (%s): %s" % (ffmpeg, exc))
    if res.returncode != 0:
        msg = res.stderr.decode("utf-8", "replace").strip().splitlines()
        raise RuntimeError("ffmpeg failed: %s" % (msg[-1] if msg else "no output"))
    data = res.stdout
    if len(data) < width * height:
        return None
    return bytearray(data[:width * height])


def parse_times(text):
    try:
        return [float(x) for x in text.split(",") if x.strip()]
    except ValueError:
        raise argparse.ArgumentTypeError("times must be numbers separated by commas")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Flag the empty-bottom reject on a vertical render.")
    ap.add_argument("video")
    ap.add_argument("--times", type=parse_times, default=[0.1, 1, 2, 3, 5],
                    help="seconds to sample, comma separated (default 0.1,1,2,3,5)")
    ap.add_argument("--threshold", type=float, default=2.0,
                    help="row detail that counts as content (default 2.0)")
    ap.add_argument("--empty-band", type=float, default=0.07,
                    help="fail when this fraction of the bottom has no detail (default 0.07)")
    ap.add_argument("--min-ratio", type=float, default=0.15,
                    help="fail when bottom-third detail is under this share of the middle third")
    ap.add_argument("--json", action="store_true", help="print JSON instead of text")
    ap.add_argument("--ffmpeg", help="ffmpeg binary (default STS_FFMPEG or ffmpeg)")
    args = ap.parse_args(argv)

    if not os.path.isfile(args.video):
        print("fill_check: no such file: %s" % args.video, file=sys.stderr)
        return 2
    ffmpeg = tool_path(args.ffmpeg, "STS_FFMPEG", "ffmpeg")
    profiles = []
    try:
        for t in args.times:
            buf = decode_gray(ffmpeg, args.video, t)
            if buf is not None:
                profiles.append(row_detail(buf, WIDTH, HEIGHT))
    except RuntimeError as exc:
        print("fill_check: %s" % exc, file=sys.stderr)
        return 2
    if not profiles:
        print("fill_check: no frame decoded at the sampled times", file=sys.stderr)
        return 2
    res = verdict(merge_max(profiles), args.threshold, args.empty_band, args.min_ratio)
    res["video"] = os.path.basename(args.video)
    res["frames"] = len(profiles)
    if args.json:
        print(json.dumps(res, indent=2))
    else:
        print("%s  content floor %.1f%% of height  bottom/middle %.2f  %s: %s" % (
            res["video"], res["floor_pct"], res["bottom_ratio"],
            "PASS" if res["ok"] else "FAIL", res["reason"]))
    return 0 if res["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
