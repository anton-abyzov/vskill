import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))  # noqa: E401,E702

import json
import shutil
import tempfile
import unittest

import compile_wide
import cut_short
import privacy_scan

GOOD = {"id": "a01-demo", "sources": {"main": "src.mp4"}, "bar": "MY TEST SUITE WENT RED",
        "facecam": [1500, 650, 300, 180], "segments": [{"in": 1.0, "out": 3.0}]}


class LoadSpec(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def load(self, **change):
        spec = json.loads(json.dumps(GOOD))
        for k, v in change.items():
            if v is None:
                spec.pop(k, None)
            else:
                spec[k] = v
        p = os.path.join(self.d, "spec.json")
        with open(p, "w") as f:
            json.dump(spec, f)
        return cut_short.load_spec(p)

    def refused(self, word, **change):
        with self.assertRaises(cut_short.CutError) as cm:
            self.load(**change)
        self.assertIn(word, str(cm.exception))

    def test_good_spec_loads(self):
        spec = self.load(variants={"b": {"bar": "IT FAILED"}}, translations={"es": {"bar": "FALLO"}, "pt-BR": {}})
        self.assertEqual(spec["src"], "main")
        self.assertEqual(spec["sources"]["main"], os.path.join(self.d, "src.mp4"))

    def test_bar_must_have_text(self):
        self.refused("bar", bar=None)
        self.refused("bar", bar="")
        self.refused("bar", bar="  \n ")
        self.refused("bar", bar=7)
        self.refused("variants.b.bar", variants={"b": {"bar": ""}})
        self.refused("translations.es.bar", translations={"es": {"bar": " "}})

    def test_names_that_become_file_names_are_plain(self):
        for bad in ("../a01", "a/b", "a b", "a:b", "a,b", "a'b", "a;b", ".hidden", "-x", "a\\b"):
            self.refused("spec id", id=bad)
            self.refused("variant name", variants={bad: {"bar": "X"}})
            self.refused("language code", translations={bad: {"bar": "X"}})
        self.refused("spec id", id=7)

    def test_speed_must_be_above_zero(self):
        for bad in (0, -1, "2", True, None):
            seg = {"in": 1.0, "out": 3.0, "speed": bad}
            self.refused("speed", segments=[seg])
            self.refused("variants.b.segments[0]", variants={"b": {"segments": [seg]}})
        self.assertEqual(self.load(segments=[{"in": 1.0, "out": 3.0, "speed": 1.5}])["segments"][0]["speed"], 1.5)

    def test_speed_and_times_must_be_finite(self):
        for bad in (float("nan"), float("inf")):
            self.refused("speed", segments=[{"in": 1.0, "out": 3.0, "speed": bad}])
            self.refused("numeric", segments=[{"in": 1.0, "out": bad}])

    def test_segment_numbers_are_checked(self):
        ok = {"in": 1.0, "out": 3.0}
        good = dict(ok, a_in=0, vol=0, z=1.2, punch=1.1, gap=0, face_dy=-40, gate=0.02)
        self.assertEqual(self.load(segments=[good])["segments"][0]["z"], 1.2)
        self.assertEqual(self.load(segments=[dict(ok, g_in=5.0, gate=None)])["segments"][0]["g_in"], 5.0)
        for key, values in (("a_in", ("5", -1, True, float("nan"))), ("g_in", ("5", -0.5, None)),
                            ("vol", ("1", -1, float("inf"))), ("z", (0, -1, "1.2", True)), ("punch", (0, "x")),
                            ("gap", (-0.1, "0.3")), ("face_dy", ("10", None, float("nan"))),
                            ("gate", ("0.02", -0.1, 1.5, True, float("nan")))):
            for bad in values:
                self.refused("\"%s\"" % key, segments=[dict(ok, **{key: bad})])
        self.refused("variants.b.segments[0]", variants={"b": {"segments": [dict(ok, z=0)]}})
        for bad in (0, -2.0, "2", True):
            self.refused("max_zoom", segments=[dict(ok, max_zoom=bad)])
            self.refused("punch", punch=bad)
        self.assertEqual(self.load(punch=1.1, segments=[dict(ok, max_zoom=3)])["punch"], 1.1)
        self.refused("\"in\" must be 0 or more", segments=[{"in": -1, "out": 1}])
        self.assertEqual(self.load(segments=[{"in": 0, "out": 1}])["segments"][0]["in"], 0)

    def test_a_moved_screen_needs_the_stack_layout(self):
        seg = {"in": 1.0, "out": 3.0, "g_in": 40.0}
        self.refused("g_in", layout="full", segments=[seg])
        self.refused("g_in", segments=[dict(seg, layout="full")])
        self.assertEqual(self.load(layout="full", segments=[dict(seg, layout="stack")])["segments"][0]["g_in"], 40.0)
        self.assertEqual(self.load(segments=[seg])["segments"][0]["g_in"], 40.0)

    def test_times_are_numbers_not_text(self):
        for seg in ({"in": "1.0", "out": 3.0}, {"in": 1.0, "out": "3.0"}, {"in": True, "out": 3.0},
                    {"in": None, "out": 3.0}, {"in": [1.0], "out": 3.0}, 5, "1-3"):
            self.refused("numeric", segments=[seg])

    def test_groups_must_be_objects(self):
        self.refused("variants", variants=["b"])
        self.refused("variants", variants={"b": "bar"})
        self.refused("translations", translations=[{"es": {}}])
        self.refused("translations", translations={"es": None})
        self.refused("sources", sources=["src.mp4"])
        self.refused("sources", sources={"main": 5})
        self.refused("transcripts", transcripts="words.json")
        p = os.path.join(self.d, "list.json")
        with open(p, "w") as f:
            f.write("[1, 2]")
        with self.assertRaises(cut_short.CutError):
            cut_short.load_spec(p)


class WideWindows(unittest.TestCase):
    def test_face_square_stays_inside_a_portrait_source(self):
        (x, y, w, h), (fx, fy, fs) = compile_wide.wide_windows({"in": 0, "out": 1}, "stack", 1080, 1920,
                                                               [100, 200, 300, 1400])
        self.assertGreaterEqual(fx, 0)
        self.assertGreaterEqual(fy, 0)
        self.assertLessEqual(fx + fs, 1080)
        self.assertLessEqual(fy + fs, 1920)

    def test_landscape_source_is_unchanged(self):
        _, face = compile_wide.wide_windows({"in": 0, "out": 1}, "stack", 1920, 1080, [1500, 650, 300, 180])
        self.assertEqual(face, (1500, 590, 300))


@unittest.skipIf(os.name == "nt", "needs a POSIX shell for the stand-in tools")
class PrivacyScanFrames(unittest.TestCase):
    """scan() with stand-ins for ffmpeg and tesseract: no real tool, no video."""

    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.frames = os.path.join(self.d, "frames.txt")
        self.ffmpeg = self.tool("ffmpeg", (
            "import sys\n"
            "out = sys.argv[-1]\n"
            "n = int(open(%r).read()) if '%%05d' in out else 1\n"
            "for i in range(n):\n"
            "    open(out %% (i + 1) if '%%05d' in out else out, 'wb').close()\n") % self.frames)
        self.tesseract = self.tool("tesseract", "print('line on screen')\nprint('mail someone' + chr(64) + 'example.invalid')\n")

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def tool(self, name, body):
        py = os.path.join(self.d, name + ".py")
        with open(py, "w") as f:
            f.write(body)
        sh = os.path.join(self.d, name)
        with open(sh, "w") as f:
            f.write("#!/bin/sh\nexec '%s' -B '%s' \"$@\"\n" % (sys.executable, py))
        os.chmod(sh, 0o755)
        return sh

    def scan(self, video, out, frames):
        with open(self.frames, "w") as f:
            f.write(str(frames))
        return privacy_scan.scan(video, out, fps=4.0, ffmpeg=self.ffmpeg, tesseract=self.tesseract)

    def test_brackets_and_stars_in_names_do_not_hide_the_frames(self):
        for folder, video in (("batch [1]/checks", "a01-demo.mp4"), ("checks", "stream [part 1].mp4"),
                              ("out*", "what?.mp4"), ("plain", "a01-demo.mp4")):
            out = os.path.join(self.d, folder)
            name, frames, rows = self.scan(os.path.join(self.d, video), out, 3)
            self.assertEqual(frames, 3, (folder, video))
            self.assertEqual([r["text"] for r in rows][0], "line on screen")
            self.assertTrue(any("email" in r["flags"] for r in rows), rows)
            self.assertEqual(sorted(os.listdir(out)), [name + ".ocr.json", name + ".ocr.txt"])

    def test_zero_frames_is_an_error_not_a_clean_scan(self):
        out = os.path.join(self.d, "checks")
        with self.assertRaises(RuntimeError) as cm:
            self.scan(os.path.join(self.d, "a01-demo.mp4"), out, 0)
        self.assertIn("0 frames", str(cm.exception))
        self.assertEqual(os.listdir(out), [])


if __name__ == "__main__":
    unittest.main()
