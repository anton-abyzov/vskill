#!/usr/bin/env python3
"""Contact sheet: frames of a video at chosen times, tiled into one image.

    sheet.py video.mp4 sheet.jpg                      # the opening check: 0, 0.5, 1, 2, 3 s
    sheet.py video.mp4 sheet.jpg --times 600,610,620 --cols 3 --cell 480
    sheet.py video.mp4 sheet.jpg --fontfile /path/to/font.ttf

Each cell gets its time burned in the corner when the ffmpeg has the drawtext
filter. Without drawtext the sheet is made without labels and the times are
printed in order (left to right, top to bottom). --fontfile is passed to
drawtext; without it drawtext uses its default font.

Options: --cols N (default: number of times, at most 5), --cell W (cell width
in pixels, default 320), --ffmpeg PATH (default $STS_FFMPEG or ffmpeg).
Exit 0 on success, 1 with a one-line reason on failure.
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile

DEFAULT_TIMES = [0, 0.5, 1, 2, 3]


def has_filter(ffmpeg, name):
    try:
        r = subprocess.run([ffmpeg, "-hide_banner", "-filters"], capture_output=True, text=True, errors="replace")
    except OSError:
        return False
    return any(re.match(r"^\s*\S+\s+%s\s" % re.escape(name), line) for line in r.stdout.splitlines())


def label_for(t):
    """Seconds, plus h mm ss from one minute on (drawtext needs no escaping for these)."""
    return "%gs" % t if t < 60 else "%gs  %d %02d %02d" % (t, t // 3600, t % 3600 // 60, t % 60)


def drawtext(label, fontfile=None):
    font = ""
    if fontfile:
        font = "fontfile='%s':" % fontfile.replace("\\", "\\\\").replace("'", "\\'").replace(":", "\\:")
    return ",drawtext=%stext='%s':x=6:y=6:fontsize=22:fontcolor=yellow:box=1:boxcolor=black@0.7" % (font, label)


def frame(ffmpeg, video, t, cell, path, label=None, fontfile=None):
    vf = "scale=%d:-2" % cell + (drawtext(label, fontfile) if label else "")
    r = subprocess.run([ffmpeg, "-v", "error", "-ss", str(t), "-i", video, "-frames:v", "1", "-vf", vf, "-y", path],
                       capture_output=True, text=True, errors="replace")
    return r.returncode == 0 and os.path.exists(path) and os.path.getsize(path) > 0, r.stderr.strip()


def main(argv=None):
    ap = argparse.ArgumentParser(description="Contact sheet of a video at chosen times.",
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    ap.add_argument("video")
    ap.add_argument("out")
    ap.add_argument("--times", help="comma-separated seconds (default 0,0.5,1,2,3)")
    ap.add_argument("--cols", type=int)
    ap.add_argument("--cell", type=int, default=320)
    ap.add_argument("--fontfile")
    ap.add_argument("--ffmpeg")
    args = ap.parse_args(argv)
    try:
        times = [float(t) for t in args.times.split(",")] if args.times else list(DEFAULT_TIMES)
    except ValueError:
        ap.error("--times must be comma-separated seconds")
    if not times or args.cell < 16 or (args.cols is not None and args.cols < 1):
        ap.error("need at least one time, --cell of 16 or more and --cols of 1 or more")
    ff = args.ffmpeg or os.environ.get("STS_FFMPEG") or "ffmpeg"
    if shutil.which(ff) is None and not os.path.isfile(ff):
        print("sheet: ffmpeg not found: %s" % ff, file=sys.stderr)
        return 1
    if not os.path.exists(args.video):
        print("sheet: video not found: %s" % args.video, file=sys.stderr)
        return 1
    labels = has_filter(ff, "drawtext")
    cols = args.cols or min(5, len(times))
    rows = (len(times) + cols - 1) // cols
    tmp = tempfile.mkdtemp(prefix="sheet-")
    try:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        for i, t in enumerate(times):
            p = os.path.join(tmp, "%04d.jpg" % i)
            ok, err = frame(ff, args.video, t, args.cell, p, label_for(t) if labels else None, args.fontfile)
            if not ok and labels:
                ok, _ = frame(ff, args.video, t, args.cell, p)
                if ok:      # the frame exists, so drawtext is what failed
                    labels = False
                    print("note: drawtext failed (%s); making the sheet without labels"
                          % (err.splitlines()[-1] if err else "no output"))
                    for j in range(i):
                        ok, err = frame(ff, args.video, times[j], args.cell, os.path.join(tmp, "%04d.jpg" % j))
                        if not ok:
                            break
            if not ok:
                print("sheet: no frame at %gs (past the end of the video?)" % t, file=sys.stderr)
                return 1
        r = subprocess.run([ff, "-v", "error", "-framerate", "1", "-i", os.path.join(tmp, "%04d.jpg"),
                            "-vf", "tile=%dx%d" % (cols, rows), "-frames:v", "1", "-q:v", "3", "-y", args.out],
                           capture_output=True, text=True, errors="replace")
        if r.returncode != 0:
            lines = r.stderr.strip().splitlines()
            print("sheet: tiling failed: %s" % (lines[-1] if lines else "exit %d" % r.returncode), file=sys.stderr)
            return 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if not labels:
        print("no labels (this ffmpeg has no drawtext); times in order: " + ", ".join("%g" % t for t in times))
    print(args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
