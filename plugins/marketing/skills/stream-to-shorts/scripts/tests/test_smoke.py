import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import json
import shutil
import subprocess
import tempfile
import unittest

import cut_short

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "cut_short.py")
FFMPEG = os.environ.get("STS_FFMPEG") or shutil.which("ffmpeg")
FFPROBE = os.environ.get("STS_FFPROBE") or shutil.which("ffprobe")
HAVE = bool(FFMPEG and FFPROBE and cut_short.has_filter(FFMPEG, "ass"))


def shots_first_end(path):
    with open(path) as f:
        return round(json.load(f)[0]["t1"], 2)


@unittest.skipUnless(HAVE, "needs an ffmpeg with the ass filter (STS_FFMPEG or PATH) and ffprobe")
class SmokeRender(unittest.TestCase):
    def test_render_stack(self):
        tmp = tempfile.mkdtemp(prefix="sts-smoke-")
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        src = os.path.join(tmp, "main.mp4")
        r = subprocess.run([FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30:duration=20",
                            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=20",
                            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", src],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr[-500:])
        # source-time transcript for the tight segments
        source_words = []
        t = 2.0
        for i in range(30):
            source_words.append({"w": "word%d" % i, "s": round(t, 2), "e": round(t + 0.3, 2)})
            t += 0.4 if i % 6 else 1.2
        with open(os.path.join(tmp, "main.words.json"), "w") as f:
            json.dump(source_words, f)
        # output-time caption words
        cap_words = [{"w": w, "s": round(0.05 + i * 0.35, 2), "e": round(0.05 + i * 0.35 + 0.3, 2)}
                     for i, w in enumerate("this is a quick smoke test of the cutter.".split())]
        words_path = os.path.join(tmp, "caps.json")
        with open(words_path, "w") as f:
            json.dump(cap_words, f)
        spec = {"id": "a01-demo", "sources": {"main": "main.mp4"}, "transcripts": {"main": "main.words.json"},
                "src": "main", "layout": "stack", "bar": "Smoke test", "facecam": [1500, 650, 300, 180],
                "segments": [{"in": 2.0, "out": 6.0, "tight": True, "win": [200, 100, 900, 700]},
                             {"in": 9.0, "out": 12.0, "tight": True, "crop": [600, 200, 800, 600]}],
                "labels": [{"at": 0.5, "dur": 1.0, "text": "LABEL"}]}
        spec_path = os.path.join(tmp, "spec.json")
        with open(spec_path, "w") as f:
            json.dump(spec, f)
        out = os.path.join(tmp, "out")
        r = subprocess.run([sys.executable, SCRIPT, "render", spec_path, "--out", out, "--words", words_path,
                            "--ffmpeg", FFMPEG, "--ffprobe", FFPROBE, "--transcribe-cmd", "off"],
                           capture_output=True, text=True)
        sys.stdout.write(r.stdout)
        self.assertEqual(r.returncode, 0, r.stderr[-800:])
        master = os.path.join(out, "a01-demo.mp4")
        self.assertTrue(os.path.exists(master))
        p = subprocess.run([FFPROBE, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                            "-of", "json", master], capture_output=True, text=True)
        st = json.loads(p.stdout)["streams"][0]
        self.assertEqual((st["width"], st["height"]), (1080, 1920))
        with open(os.path.join(out, "metrics.json")) as f:
            met = json.load(f)
        self.assertIn("first_word_s", met)
        self.assertEqual(met["first_change_s"], shots_first_end(os.path.join(out, "shots.json")))
        self.assertEqual(met["words_source"], "words-file")
        self.assertTrue(-15.5 <= met["loudness"]["I"] <= -12.5, met["loudness"])
        with open(os.path.join(out, "shots.json")) as f:
            shots = json.load(f)
        self.assertTrue(shots)
        self.assertGreater(len(shots), 2)          # tight cuts split the segments
        with open(os.path.join(out, "burned.json")) as f:
            self.assertTrue(json.load(f))          # the words as burned, for caption_check.py


if __name__ == "__main__":
    unittest.main()
