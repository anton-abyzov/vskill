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


SMALL = (108, 192)      # the master, a tenth of its size, is enough to see a cut and a label


def small_frames(path):
    """Every frame of a video as rows of (r, g, b), scaled down to SMALL."""
    r = subprocess.run([FFMPEG, "-v", "error", "-i", path, "-vf", "scale=%d:%d" % SMALL, "-f", "rawvideo",
                        "-pix_fmt", "rgb24", "-"], capture_output=True)
    size = SMALL[0] * SMALL[1] * 3
    return [r.stdout[i:i + size] for i in range(0, len(r.stdout) - size + 1, size)]


def screen_level(frame):
    """Mean green level of the screen panel, away from the label and captions."""
    w = SMALL[0]
    rows = range(130, 180)
    return sum(frame[(y * w + x) * 3 + 1] for y in rows for x in range(20, 90)) / float(len(rows) * 70)


def red_pixels(frame):
    """Red pixels where the label sits (the picture is grey, the label box red)."""
    w = SMALL[0]
    n = 0
    for y in range(78, 93):
        for x in range(20, 76):
            r, g, b = frame[(y * w + x) * 3:(y * w + x) * 3 + 3]
            if r - g > 60 and r - b > 60:
                n += 1
    return n


def count(args):
    return subprocess.run([FFPROBE, "-v", "error"] + args, capture_output=True, text=True).stdout.strip()


@unittest.skipUnless(HAVE, "needs an ffmpeg with the ass filter (STS_FFMPEG or PATH) and ffprobe")
class FrameGridRender(unittest.TestCase):
    """The render itself: shots on the frame grid, a label on its cut frame,
    and a room-tone bed under a stream whose pauses are digital silence."""

    def render(self, tmp, spec, command="render"):
        spec_path = os.path.join(tmp, "spec.json")
        with open(spec_path, "w") as f:
            json.dump(spec, f)
        r = subprocess.run([sys.executable, SCRIPT, command, spec_path, "--out", os.path.join(tmp, "out"),
                            "--words", os.path.join(tmp, "caps.json"), "--ffmpeg", FFMPEG, "--ffprobe", FFPROBE,
                            "--transcribe-cmd", "off"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr[-800:])
        return r.stdout

    def test_grid_label_and_bed(self):
        import audio_check
        import cutplan
        tmp = tempfile.mkdtemp(prefix="sts-grid-")
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        # A grey picture that gets lighter with time, so a jump in the source
        # shows as a jump in level; a tone gated to digital silence 0.4 s of
        # every second, like a stream behind a noise gate.
        r = subprocess.run([FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i",
                            "color=c=gray:size=1920x1080:rate=30:duration=20,eq=brightness='t/40-0.25':eval=frame",
                            "-f", "lavfi", "-i",
                            "aevalsrc='0.3*sin(2*PI*440*t)*gt(mod(t,1),0.4)':sample_rate=48000:duration=20",
                            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "pcm_s16le",
                            "-shortest", os.path.join(tmp, "main.mov")], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr[-500:])
        with open(os.path.join(tmp, "caps.json"), "w") as f:
            json.dump([{"w": "one", "s": 0.05, "e": 0.3}, {"w": "two", "s": 0.4, "e": 0.7}], f)
        spec = {"id": "a01-demo", "sources": {"main": "main.mov"}, "src": "main", "layout": "stack",
                "bar": "Grid test", "facecam": [1500, 650, 300, 180], "bed": -55,
                # lengths that are not whole frames, one at another speed
                "segments": [{"in": 2.0, "out": 3.37}, {"in": 6.011, "out": 7.2, "speed": 1.1},
                             {"in": 12.0, "out": 14.05}, {"in": 15.0, "out": 15.75, "speed": 0.9}],
                # typed 0.1 s early and too short, as a hand-timed label is
                "labels": [{"at": 1.26, "dur": 0.6, "text": "LABEL"}]}
        out = os.path.join(tmp, "out")
        said = self.render(tmp, spec)
        self.assertNotIn("WARN", said)                        # a clean render has nothing to warn about
        with open(os.path.join(out, "shots.json")) as f:
            shots = json.load(f)
        cuts = cutplan.cut_frames(shots)
        total = cuts[-1]
        self.assertEqual(total, 41 + 32 + 61 + 25)            # each segment rounded down to whole frames

        # 1. The cut is exactly as long as the plan, picture and sound: a
        # shot that ran long or short would have been padded at the join.
        base = os.path.join(out, "base.nut")
        self.assertEqual(count(["-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames",
                                "-of", "csv=p=0", base]), str(total))
        pcm = subprocess.run([FFMPEG, "-v", "error", "-i", base, "-ac", "1", "-f", "s16le", "-"], capture_output=True).stdout
        self.assertEqual(len(pcm) // 2, total * 1600)
        with open(os.path.join(out, "metrics.json")) as f:
            met = json.load(f)
        self.assertEqual(met["planned_s"], round(total / 30.0, 3))
        self.assertEqual(met["duration_s"], round(total / 30.0, 2))
        self.assertEqual(met["bed_dbfs"], -55)

        # 2. The picture jumps on the planned frames and nowhere else.
        frames = small_frames(os.path.join(out, "a01-demo.mp4"))
        self.assertEqual(len(frames), total)
        levels = [screen_level(fr) for fr in frames]
        jumps = [i for i in range(1, total) if abs(levels[i] - levels[i - 1]) > 4]
        self.assertEqual(jumps, [41, 73, 134])

        # 3. The label starts on the frame of its cut and ends on the next cut.
        self.assertEqual(met["labels"], [{"text": "LABEL", "at": round(41 / 30.0, 3), "end": round(73 / 30.0, 3),
                                          "typed_at": 1.26, "typed_end": 1.86, "on_cuts": True,
                                          "shown": True}])
        shown = [i for i in range(total) if red_pixels(frames[i]) > 40]
        self.assertEqual(shown, list(range(41, 73)))

        # 4. With the bed no pause is a hole; without it every gated pause is.
        master = os.path.join(out, "a01-demo.mp4")
        rms = audio_check.rms_windows(audio_check.pcm(FFMPEG, master, 48000), 48000)
        self.assertEqual(audio_check.dropouts(rms), [])
        quiet = sorted(rms)[:len(rms) // 5]
        self.assertTrue(all(-58.0 < x < -52.0 for x in quiet), (quiet[0], quiet[-1]))       # about -55 dBFS
        del spec["bed"]
        self.render(tmp, spec, "finish")
        rms = audio_check.rms_windows(audio_check.pcm(FFMPEG, master, 48000), 48000)
        self.assertGreaterEqual(len(audio_check.dropouts(rms)), 3)

    def source(self, tmp, name, rate, seconds=10):
        """A moving picture at `rate` frames a second with a steady tone."""
        r = subprocess.run([FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i",
                            "testsrc2=size=640x360:rate=%s:duration=%d" % (rate, seconds),
                            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=%d" % seconds,
                            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "pcm_s16le",
                            "-ar", "48000", "-ac", "2", os.path.join(tmp, name)], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr[-500:])

    def lengths(self, base):
        """(picture frames, sound samples) of a base cut."""
        frames = count(["-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames",
                        "-of", "csv=p=0", base])
        pcm = subprocess.run([FFMPEG, "-v", "error", "-i", base, "-ac", "1", "-f", "s16le", "-"], capture_output=True).stdout
        return int(frames), len(pcm) // 2

    def faded(self, master, total):
        """True when the sound of the master is fading out at its last frame."""
        import audio_check
        pcm = audio_check.pcm(FFMPEG, master, 48000)
        end = total * 1600
        before = max(abs(x) for x in pcm[end - 9600:end - 7200])
        last = max(abs(x) for x in pcm[end - 240:end])
        return before > 2000 and last < before * 0.3

    def test_other_frame_rates_and_slowed_shots_keep_their_frame_count(self):
        # A source that is not at 30 frames a second, and a slowed shot, run
        # out of frames before the planned count; the picture must be held,
        # not cut short with its sound.
        import cutplan
        tmp = tempfile.mkdtemp(prefix="sts-rates-")
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        with open(os.path.join(tmp, "caps.json"), "w") as f:
            json.dump([{"w": "one", "s": 0.05, "e": 0.3}], f)
        cases = [("24", [{"in": 3.0, "out": 3.733, "still": True}, {"in": 3.733, "out": 4.467, "still": True}], 44),
                 ("30", [{"in": 1.0, "out": 1.7, "speed": 0.5, "still": True}, {"in": 3.0, "out": 4.0, "still": True}], 72),
                 ("25", [{"in": 2.0, "out": 2.5, "speed": 0.75}, {"in": 6.02, "out": 7.31}], 20 + 38),
                 ("30000/1001", [{"in": 1.0, "out": 3.9, "speed": 1.1}, {"in": 5.0, "out": 5.9, "speed": 0.5}], 79 + 54),
                 ("60", [{"in": 1.0, "out": 1.517}, {"in": 4.0, "out": 4.7, "speed": 2}], 15 + 10)]
        for rate, segments, planned in cases:
            self.source(tmp, "main.mov", rate)
            shutil.rmtree(os.path.join(tmp, "out"), ignore_errors=True)
            spec = {"id": "a01-demo", "sources": {"main": "main.mov"}, "src": "main", "layout": "full",
                    "bar": "Rates test", "segments": segments}
            said = self.render(tmp, spec)
            self.assertNotIn("WARN", said, rate)
            out = os.path.join(tmp, "out")
            with open(os.path.join(out, "shots.json")) as f:
                total = cutplan.cut_frames(json.load(f))[-1]
            self.assertEqual(total, planned, rate)
            self.assertEqual(self.lengths(os.path.join(out, "base.nut")), (total, total * 1600), rate)
            with open(os.path.join(out, "metrics.json")) as f:
                met = json.load(f)
            self.assertEqual(met["duration_s"], round(met["planned_s"], 2), rate)
            master = os.path.join(out, "a01-demo.mp4")
            self.assertEqual(len(small_frames(master)), total, rate)
            self.assertTrue(self.faded(master, total), rate)      # the closing fade runs inside the clip

    def test_a_shot_past_the_end_of_the_source_is_warned_about(self):
        tmp = tempfile.mkdtemp(prefix="sts-end-")
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        with open(os.path.join(tmp, "caps.json"), "w") as f:
            json.dump([{"w": "one", "s": 0.05, "e": 0.3}], f)
        self.source(tmp, "main.mov", "30", seconds=4)
        spec = {"id": "a01-demo", "sources": {"main": "main.mov"}, "src": "main", "layout": "full",
                "bar": "End test", "segments": [{"in": 1.0, "out": 2.0}, {"in": 3.5, "out": 4.5, "still": True}]}
        said = self.render(tmp, spec)
        self.assertIn("WARN the shot at 3.50-4.50 reads past the end of source 'main' (4.00 s)", said)
        self.assertNotIn("off the frame grid", said)
        self.assertEqual(self.lengths(os.path.join(tmp, "out", "base.nut")), (60, 96000))

    def test_wide_compilation_is_on_the_grid_and_fades_out(self):
        tmp = tempfile.mkdtemp(prefix="sts-wide-")
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        r = subprocess.run([FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=24:duration=10",
                            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=10",
                            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "pcm_s16le",
                            "-ar", "48000", "-ac", "2", os.path.join(tmp, "main.mov")], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr[-500:])
        with open(os.path.join(tmp, "caps.json"), "w") as f:
            json.dump([{"w": "one", "s": 0.05, "e": 0.3}], f)
        paths = []
        for name, segments in (("a01-demo", [{"in": 1.0, "out": 2.37}, {"in": 3.0, "out": 3.7, "speed": 0.5}]),
                               ("a02-demo", [{"in": 5.011, "out": 6.2, "speed": 1.1}])):
            paths.append(os.path.join(tmp, name + ".json"))
            with open(paths[-1], "w") as f:
                json.dump({"id": name, "sources": {"main": "main.mov"}, "src": "main", "layout": "stack",
                           "bar": name, "facecam": [1500, 650, 300, 180], "segments": segments}, f)
        out = os.path.join(tmp, "wide")
        r = subprocess.run([sys.executable, os.path.join(HERE, "..", "compile_wide.py"), "wide-demo", "Wide demo"] + paths
                           + ["--out", out, "--words", os.path.join(tmp, "caps.json"), "--ffmpeg", FFMPEG,
                              "--ffprobe", FFPROBE, "--transcribe-cmd", "off"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr[-800:])
        self.assertNotIn("WARN", r.stdout)
        total = 41 + 42 + 32
        self.assertEqual(self.lengths(os.path.join(out, "base.nut")), (total, total * 1600))
        with open(os.path.join(out, "marks.json")) as f:
            marks = json.load(f)
        self.assertEqual([(m[0], m[1]) for m in marks], [(0.0, round(83 / 30.0, 3)), (round(83 / 30.0, 3), round(total / 30.0, 3))])
        with open(os.path.join(out, "metrics.json")) as f:
            self.assertEqual(json.load(f)["duration_s"], round(total / 30.0, 1))
        self.assertTrue(self.faded(os.path.join(out, "wide-demo.mp4"), total))


if __name__ == "__main__":
    unittest.main()
