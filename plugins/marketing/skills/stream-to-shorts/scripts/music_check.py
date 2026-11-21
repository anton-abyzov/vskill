#!/usr/bin/env python3
"""Tag music in time ranges of a file with the YAMNet audio classifier.

Usage:
    python3 music_check.py <audio-or-video> a-b [a-b ...] --model yamnet.tflite
                           [--threshold 0.15] [--all] [--ffmpeg PATH]

For each range (seconds, for example 12.5-40) it decodes 16 kHz mono audio
through ffmpeg, runs YAMNet on 0.975 s windows and prints the highest music
score in the range. Windows at or over --threshold are listed with their top
tags; --all lists every window.

Needs: pip install mediapipe numpy, and the YAMNet model file from the
MediaPipe audio classifier models page
(https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite).

The rule: a tagger score is not a listen. A low score clears nothing.
Game soundtracks, radio and quiet beds under speech score low and still draw
claims. A person, or a second model, listens to every clip before its first
post.

Exit code 0 when it ran, non-zero on an error. The score does not set the
exit code.
Environment: STS_FFMPEG names the ffmpeg binary when --ffmpeg is not given.
"""
import argparse
import os
import subprocess
import sys

MUSIC_LABELS = (
    "Music", "Musical instrument", "Singing", "Song", "Hip hop music", "Rock music",
    "Pop music", "Electronic music", "Guitar", "Drum", "Bass", "Synthesizer",
    "Soundtrack music", "Background music", "Theme music", "Video game music",
    "Rapping", "Choir", "Piano", "Radio",
)
HOP = 0.975
RATE = 16000


def parse_range(text):
    """'a-b' to (a, b) floats with b > a >= 0. Pure."""
    try:
        a, b = text.split("-", 1)
        a, b = float(a), float(b)
    except ValueError:
        raise ValueError("range must look like 12.5-40, got %r" % text)
    if a < 0 or b <= a:
        raise ValueError("range end must be after its start: %r" % text)
    return a, b


def music_score(categories):
    """Highest score among music labels in [(name, score)]. Pure."""
    return max([s for n, s in categories if n in MUSIC_LABELS] + [0.0])


def _load_engine(model):
    try:
        import numpy as np  # noqa: lazy
        from mediapipe.tasks import python as mp  # noqa: lazy
        from mediapipe.tasks.python import audio  # noqa: lazy
        from mediapipe.tasks.python.components import containers  # noqa: lazy
    except Exception as exc:  # ImportError, or a broken protobuf pairing
        raise RuntimeError("music_check needs mediapipe and numpy: pip install mediapipe numpy "
                           "(import failed: %s)" % exc.__class__.__name__)
    if not os.path.isfile(model):
        raise RuntimeError("model not found: %s. Download yamnet.tflite from the MediaPipe "
                           "audio classifier models page" % model)
    opts = audio.AudioClassifierOptions(
        base_options=mp.BaseOptions(model_asset_path=model), max_results=6)
    return np, audio, containers, opts


def classify(ffmpeg, src, a, b, engine):
    np, audio, containers, opts = engine
    cmd = [ffmpeg, "-v", "error", "-ss", str(a), "-t", str(b - a), "-i", src, "-vn",
           "-ac", "1", "-ar", str(RATE), "-f", "f32le", "-"]
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if res.returncode != 0 or not res.stdout:
        raise RuntimeError("ffmpeg could not decode %.1f-%.1f" % (a, b))
    x = np.frombuffer(res.stdout, dtype=np.float32)
    with audio.AudioClassifier.create_from_options(opts) as clf:
        results = clf.classify(containers.AudioData.create_from_array(x, RATE))
    rows = []
    for i, r in enumerate(results):
        cats = [(k.category_name, k.score) for k in r.classifications[0].categories]
        rows.append((a + i * HOP, music_score(cats), cats))
    return rows


def main(argv=None):
    ap = argparse.ArgumentParser(description="YAMNet music scores per time range. A score is not a listen.")
    ap.add_argument("src")
    ap.add_argument("ranges", nargs="+", help="a-b in seconds")
    ap.add_argument("--model", required=True, help="path to yamnet.tflite")
    ap.add_argument("--threshold", type=float, default=0.15)
    ap.add_argument("--all", action="store_true", help="print every window")
    ap.add_argument("--ffmpeg", help="ffmpeg binary (default STS_FFMPEG or ffmpeg)")
    args = ap.parse_args(argv)

    try:
        ranges = [parse_range(r) for r in args.ranges]
    except ValueError as exc:
        print("music_check: %s" % exc, file=sys.stderr)
        return 2
    if not os.path.isfile(args.src):
        print("music_check: no such file: %s" % args.src, file=sys.stderr)
        return 2
    ffmpeg = args.ffmpeg or os.environ.get("STS_FFMPEG") or "ffmpeg"
    try:
        engine = _load_engine(args.model)
        for (a, b), text in zip(ranges, args.ranges):
            rows = classify(ffmpeg, args.src, a, b, engine)
            mx = max([r[1] for r in rows] + [0.0])
            print("%s max_music=%.2f" % (text, mx))
            for t, m, cats in rows:
                if args.all or m >= args.threshold:
                    print("  %9.1f music=%.2f %s" % (t, m, ", ".join(
                        "%s:%.2f" % (n, s) for n, s in cats[:4])))
    except (RuntimeError, OSError) as exc:
        print("music_check: %s" % exc, file=sys.stderr)
        return 2
    print("A tagger score is not a listen. Listen before the first post.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
