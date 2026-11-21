#!/usr/bin/env python3
"""OCR every frame of a render and list the text it shows, with risk flags.

Usage:
    python3 privacy_scan.py <video> --out <dir> [--engine ocrmac|tesseract]
                            [--fps 4] [--upscale 2] [--lang eng]
                            [--extra-pattern REGEX ...] [--ffmpeg PATH]
                            [--tesseract PATH] [--tessdata-dir DIR]

It extracts frames at --fps, reads the text in each one, keeps every unique
line with the first time it was seen, and writes <name>.ocr.txt and
<name>.ocr.json into --out. The frames are deleted at the end.

Engines:
- ocrmac: macOS Vision through the ocrmac package (pip install ocrmac).
- tesseract: the tesseract CLI with --psm 11 (sparse text). Each frame is read
  twice, as is and after a lanczos upscale (--upscale, default 2 for this
  engine). The upscale pass finds small text the first pass misses.
  Set --upscale 1 to skip it. For ocrmac the default is 1.

Flags are hints. A line without a flag can still hold a name, a project, a
client or an id. Read the whole unique-lines file, not only the flagged lines.

The default patterns are generic: emails and social handles, URLs and domains, home
paths, IPv4 and LAN addresses, digit runs of 6 or more, code-like groups
(XXXX-XXXX), the words token, password, secret and key, and long base64-like
strings. Add your own names, employers and hosts with --extra-pattern.

The maker's scan is not the release check. An independent reviewer runs the
scan again, with the other engine, before anything is scheduled.

Exit code 0 when the scan ran (flags or not), non-zero on an error.
Environment: STS_FFMPEG and STS_TESSERACT name the binaries when the flags
are not given.
"""
import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

# Common top-level domains for the bare-domain pattern. Kept short on purpose:
# a domain with another ending still shows up in the unique-lines file.
_TLDS = ("com|net|org|io|ai|dev|app|co|me|tv|gg|xyz|info|biz|ru|uk|de|fr|es|it|nl|"
         "us|ca|au|in|jp|cn|so|sh|cloud|link|site|online|tech|studio|page|live")

RISK_PATTERNS = [
    ("email", re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")),
    ("handle", re.compile(r"(?<![\w.@])@[A-Za-z0-9_][A-Za-z0-9_.]{1,}")),
    ("url", re.compile(r"(?i)\b(?:https?://|www\.)\S+")),
    ("domain", re.compile(r"(?i)\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:%s)\b" % _TLDS)),
    # The macOS home prefix is assembled so a repository-wide path grep stays clean.
    ("home-path", re.compile(r"(?i)(?:/" + "Users" + r"/\w|/home/\w|\b[A-Z]:\\+Users\\+\w|~/)")),
    ("ipv4", re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")),
    ("lan-ip", re.compile(r"\b(?:192\.168\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}"
                          r"|10\.\d{1,3}\.\d{1,3})\b")),
    ("digits", re.compile(r"(?<![\d.])\d{6,}(?![\d.]\d)")),
    ("code", re.compile(r"\b[A-Z0-9]{4}-[A-Z0-9]{4}\b")),
    ("secret-word", re.compile(r"(?i)\b(?:token|tokens|password|passwd|secret|secrets|"
                               r"key|keys|api[ _-]?key)\b")),
]

_B64 = re.compile(r"[A-Za-z0-9+/]{24,}")
_B64URL = re.compile(r"[A-Za-z0-9+/=_-]{24,}")


def _base64_like(text):
    """Any run of 24 or more base64 characters, or a URL-safe run (with _ or
    -) of 24 or more that mixes letters with digits or both cases."""
    if _B64.search(text):
        return True
    for m in _B64URL.finditer(text):
        s = m.group(0)
        has_digit = any(c.isdigit() for c in s)
        has_upper = any(c.isupper() for c in s)
        has_lower = any(c.islower() for c in s)
        if (has_digit and (has_upper or has_lower)) or (has_upper and has_lower):
            return True
    return False


def compile_extra(patterns):
    """Compile user patterns, case-insensitive."""
    return [re.compile(p, re.I) for p in patterns or []]


def risk_flags(text, extra=()):
    """Names of the risk patterns that match text. Pure."""
    flags = [name for name, rx in RISK_PATTERNS if rx.search(text)]
    if _base64_like(text):
        flags.append("base64-like")
    if any(rx.search(text) for rx in extra):
        flags.append("extra")
    return flags


def add_lines(seen, lines, t, min_alnum=3):
    """Record each new line with its first time seen. Lines with fewer than
    min_alnum letters or digits are OCR noise and are dropped. Pure."""
    for line in lines:
        s = " ".join(line.split())
        if sum(1 for c in s if c.isalnum()) >= min_alnum and s not in seen:
            seen[s] = round(t, 2)
    return seen


def build_report(seen, extra=()):
    """Sorted rows {text, first_seen, flags}. Pure."""
    rows = []
    for text, t in sorted(seen.items(), key=lambda kv: (kv[1], kv[0])):
        rows.append({"text": text, "first_seen": t, "flags": risk_flags(text, extra)})
    return rows


def format_txt(name, engine, fps, frames, rows):
    head = ["%s" % name,
            "engine %s, %d frames at %s fps" % (engine, frames, fps),
            "flags are hints: read every line for names, projects and ids", ""]
    body = []
    for r in rows:
        tag = ("RISK[%s] " % ",".join(r["flags"])) if r["flags"] else ""
        body.append("%7.2f  %s%s" % (r["first_seen"], tag, r["text"]))
    return "\n".join(head + body) + "\n"


# ---- engines -----------------------------------------------------------------

def _ocrmac_reader():
    try:
        from ocrmac import ocrmac  # noqa: lazy, macOS only
    except ImportError:
        raise RuntimeError("engine ocrmac needs the ocrmac package on macOS: "
                           "pip install ocrmac (or use --engine tesseract)")

    def read(path):
        return [r[0] for r in ocrmac.OCR(path, recognition_level="accurate").recognize()]
    return read


def _tesseract_reader(binary, lang, tessdata):
    if shutil.which(binary) is None and not os.path.isfile(binary):
        raise RuntimeError("tesseract not found (%s): brew install tesseract, "
                           "or apt install tesseract-ocr" % binary)

    def read(path):
        cmd = [binary]
        if tessdata:
            cmd += ["--tessdata-dir", tessdata]
        cmd += [path, "stdout", "--psm", "11", "-l", lang]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if res.returncode != 0:
            err = res.stderr.decode("utf-8", "replace").strip().splitlines()
            raise RuntimeError("tesseract failed: %s" % (err[-1] if err else "no output"))
        return res.stdout.decode("utf-8", "replace").splitlines()
    return read


def _upscale(ffmpeg, src, dst, factor):
    cmd = [ffmpeg, "-v", "error", "-y", "-i", src,
           "-vf", "scale=iw*%s:ih*%s:flags=lanczos" % (factor, factor), dst]
    if subprocess.run(cmd).returncode != 0:
        raise RuntimeError("ffmpeg upscale failed on %s" % os.path.basename(src))


def scan(video, out, engine="tesseract", fps=4.0, upscale=None, lang="eng",
         extra=(), ffmpeg="ffmpeg", tesseract="tesseract", tessdata=None):
    if upscale is None:
        upscale = 2.0 if engine == "tesseract" else 1.0
    if engine == "ocrmac":
        read = _ocrmac_reader()
    else:
        read = _tesseract_reader(tesseract, lang, tessdata)
    os.makedirs(out, exist_ok=True)
    name = os.path.splitext(os.path.basename(video))[0]
    work = tempfile.mkdtemp(prefix="privacy-%s-" % name, dir=out)
    try:
        res = subprocess.run([ffmpeg, "-v", "error", "-y", "-i", video,
                              "-vf", "fps=%s" % fps, os.path.join(work, "f%05d.png")])
        if res.returncode != 0:
            raise RuntimeError("ffmpeg could not extract frames from %s" % video)
        frames = sorted(glob.glob(os.path.join(work, "f*.png")))
        seen = {}
        for i, path in enumerate(frames):
            t = i / float(fps)
            add_lines(seen, read(path), t)
            if upscale and upscale > 1:
                big = path[:-4] + ".up.png"
                _upscale(ffmpeg, path, big, upscale)
                add_lines(seen, read(big), t)
                os.remove(big)
            os.remove(path)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    rows = build_report(seen, extra)
    with open(os.path.join(out, name + ".ocr.txt"), "w", encoding="utf-8") as fh:
        fh.write(format_txt(name, engine, fps, len(frames), rows))
    with open(os.path.join(out, name + ".ocr.json"), "w", encoding="utf-8") as fh:
        json.dump({"video": os.path.basename(video), "engine": engine, "fps": fps,
                   "upscale": upscale, "frames": len(frames), "lines": rows},
                  fh, ensure_ascii=False, indent=1)
    return name, len(frames), rows


def main(argv=None):
    ap = argparse.ArgumentParser(description="OCR a render and flag risky text.")
    ap.add_argument("video")
    ap.add_argument("--out", required=True, help="folder for <name>.ocr.txt and .ocr.json")
    ap.add_argument("--engine", choices=("ocrmac", "tesseract"), default="tesseract")
    ap.add_argument("--fps", type=float, default=4.0)
    ap.add_argument("--upscale", type=float, default=None,
                    help="second pass at this scale (default 2 for tesseract, 1 for ocrmac)")
    ap.add_argument("--lang", default="eng", help="tesseract languages, e.g. eng+spa")
    ap.add_argument("--extra-pattern", action="append", default=[],
                    help="your own regex to flag (names, employers, hosts); repeatable")
    ap.add_argument("--ffmpeg", help="ffmpeg binary (default STS_FFMPEG or ffmpeg)")
    ap.add_argument("--tesseract", help="tesseract binary (default STS_TESSERACT or tesseract)")
    ap.add_argument("--tessdata-dir", help="tesseract language data folder")
    args = ap.parse_args(argv)

    if not os.path.isfile(args.video):
        print("privacy_scan: no such file: %s" % args.video, file=sys.stderr)
        return 2
    try:
        extra = compile_extra(args.extra_pattern)
    except re.error as exc:
        print("privacy_scan: bad --extra-pattern: %s" % exc, file=sys.stderr)
        return 2
    ffmpeg = args.ffmpeg or os.environ.get("STS_FFMPEG") or "ffmpeg"
    tess = args.tesseract or os.environ.get("STS_TESSERACT") or "tesseract"
    try:
        name, frames, rows = scan(args.video, args.out, args.engine, args.fps,
                                  args.upscale, args.lang, extra, ffmpeg, tess,
                                  args.tessdata_dir)
    except (RuntimeError, OSError) as exc:
        print("privacy_scan: %s" % exc, file=sys.stderr)
        return 2
    flagged = sum(1 for r in rows if r["flags"])
    print("%s: %d frames, %d unique lines, %d flagged. Read %s.ocr.txt in full."
          % (name, frames, len(rows), flagged, os.path.join(args.out, name)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
