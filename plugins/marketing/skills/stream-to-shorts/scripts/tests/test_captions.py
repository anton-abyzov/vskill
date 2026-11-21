import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import json
import tempfile
import unittest

import captions
from captions import apply_fixes, ass_time, bar_font_size, build_ass, chunk_words


def w(text, s, e):
    return {"w": text, "s": s, "e": e}


def events(text, style=None):
    ev = [l for l in text.splitlines() if l.startswith("Dialogue:")]
    if style:
        ev = [l for l in ev if l.split(",")[3] == style]
    return ev


SPEC = {
    "id": "a02-limit", "src": "main", "layout": "stack", "bar": "Demo hits the limit",
    "facecam": [1500, 650, 300, 180],
    "labels": [{"at": 1.0, "dur": 2.0, "text": "NEXT DAY"}, {"at": 4.0, "dur": 1.0, "text": "LOW", "y": 1600}],
    "translations": {"es": {"bar": "La demo llega al limite", "caps": [[0, 2.0, "una frase traducida bastante larga aqui"]],
                            "labels": {"0": "AL DIA SIGUIENTE", "LOW": "BAJO"}}},
}


class Basics(unittest.TestCase):
    def test_ass_time(self):
        self.assertEqual(ass_time(0), "0:00:00.00")
        self.assertEqual(ass_time(-3), "0:00:00.00")
        self.assertEqual(ass_time(61.5), "0:01:01.50")
        self.assertEqual(ass_time(3725.25), "1:02:05.25")
        self.assertEqual(ass_time(9999), "2:46:39.00")

    def test_bar_font_size(self):
        self.assertEqual(bar_font_size("SHORT"), 74)                    # one-line cap
        self.assertEqual(bar_font_size("A\nB"), 46)                     # two-line cap
        self.assertEqual(bar_font_size("X" * 30), int(780 / (0.52 * 30)))
        self.assertEqual(bar_font_size("ab\n" + "Y" * 40), int(780 / (0.52 * 40)))

    def test_ass_color(self):
        self.assertEqual(captions.ass_color("#FFE500"), "&H0000E5FF&")
        self.assertEqual(captions.ass_color("&H00FFE500&"), "&H00FFE500&")
        with self.assertRaises(ValueError):
            captions.ass_color("yellow")


class Fixes(unittest.TestCase):
    def test_fix_exact_then_lower(self):
        out = apply_fixes([w("Gpt", 0, 1), w("colour", 1, 2), w("keep", 2, 3)], {"gpt": "GPT", "colour": "color"})
        self.assertEqual([x["w"] for x in out], ["GPT", "color", "keep"])

    def test_fix_empty_removes(self):
        out = apply_fixes([w("uh,", 0, 1), w("go", 1, 2)], {"uh,": ""})
        self.assertEqual([x["w"] for x in out], ["go"])

    def test_cap_edit_ranges(self):
        words = [w("a", 0.0, 0.2), w("b", 0.5, 0.7), w("c", 1.0, 1.2), w("d", 1.5, 1.7)]
        out = apply_fixes(words, {}, [[0.4, 0.9, "B2"], [1.0, 1.5, ""]])
        self.assertEqual([x["w"] for x in out], ["a", "B2", "d"])          # end of a range is exclusive

    def test_does_not_mutate_input(self):
        words = [w("a", 0, 1)]
        apply_fixes(words, {"a": "b"})
        self.assertEqual(words[0]["w"], "a")

    def test_burned_words_base_and_variant(self):
        import captions
        words = [w("for", 0.0, 0.2), w("tea", 0.3, 0.5), w("tea", 1.0, 1.2)]
        spec = {"fix": {"for": "four"}, "cap_edit": [[0.25, 0.6, "40"]],
                "variants": {"b": {"cap_edit": [[0.9, 1.3, ""]]}}}
        self.assertEqual([x["w"] for x in captions.burned_words(spec, words)], ["four", "40", "tea"])
        # a variant uses only its own cap_edit; the fix map still applies
        self.assertEqual([x["w"] for x in captions.burned_words(spec, words, "b")], ["four", "tea"])


class Chunking(unittest.TestCase):
    def texts(self, words, **kw):
        return [[x["w"] for x in ch] for ch in chunk_words(words, **kw)]

    def test_three_words(self):
        ws = [w(t, i * 0.3, i * 0.3 + 0.2) for i, t in enumerate("a b c d e".split())]
        self.assertEqual(self.texts(ws), [["a", "b", "c"], ["d", "e"]])

    def test_gap_over_0_4(self):
        ws = [w("a", 0.0, 0.2), w("b", 0.6, 0.8), w("c", 1.21, 1.4)]
        self.assertEqual(self.texts(ws), [["a", "b"], ["c"]])

    def test_thirteen_chars(self):
        ws = [w("abcdef", 0.0, 0.2), w("ghijklm", 0.25, 0.4), w("n", 0.45, 0.5)]
        self.assertEqual(self.texts(ws), [["abcdef", "ghijklm"], ["n"]])
        ws = [w("abcdef", 0.0, 0.2), w("ghijklmn", 0.25, 0.4)]
        self.assertEqual(self.texts(ws), [["abcdef"], ["ghijklmn"]])

    def test_sentence_end(self):
        ws = [w("done.", 0.0, 0.2), w("next", 0.25, 0.4), w("why?", 0.45, 0.6), w("ok", 0.65, 0.7)]
        self.assertEqual(self.texts(ws), [["done."], ["next", "why?"], ["ok"]])

    def test_no_char_rule(self):
        ws = [w("abcdefghij", 0.0, 0.2), w("klmnopqrst", 0.25, 0.4)]
        self.assertEqual(self.texts(ws, max_words=4, max_chars=None), [["abcdefghij", "klmnopqrst"]])


class BuildAss(unittest.TestCase):
    def test_bar_label_and_caption_events(self):
        words = [w("go,", 0.1, 0.4), w("on", 0.45, 0.8), w("friend.", 0.85, 1.2)]
        text = build_ass(SPEC, words)
        bar = events(text, "Bar")
        self.assertEqual(len(bar), 1)
        self.assertIn("{\\pos(476,700)}DEMO HITS THE LIMIT", bar[0])
        labels = events(text, "Label")
        self.assertIn("{\\pos(476,850)}NEXT DAY", labels[0])
        self.assertIn("{\\pos(476,1200)}LOW", labels[1])                 # labels never below y 1200
        caps = events(text, "Cap")
        self.assertEqual(len(caps), 3)
        self.assertIn("0:00:00.10,0:00:00.45", caps[0])
        self.assertIn("{\\c&H0000E5FF&}GO {\\c&H00FFFFFF&}ON {\\c&H00FFFFFF&}FRIEND", caps[0])
        self.assertIn("0:00:00.85,0:00:01.50", caps[2])                  # last word holds 0.3 s
        self.assertIn("Style: Bar,Arial Black,%d," % bar_font_size(SPEC["bar"]), text)

    def test_full_layout_positions(self):
        text = build_ass(dict(SPEC, layout="full"), [w("hi", 0.0, 0.3)])
        self.assertIn("{\\pos(476,348)}", events(text, "Bar")[0])
        self.assertIn("{\\pos(476,1120)}", events(text, "Cap")[0])
        self.assertIn("{\\pos(476,520)}", events(text, "Label")[0])

    def test_second_speaker_colour(self):
        words = [w("me", 0.0, 0.3), w("bot", 1.0, 1.3)]
        text = build_ass(dict(SPEC, alt_words=[[0.9, 2.0]]), words)
        caps = events(text, "Cap")
        self.assertIn("{\\c&H0000E5FF&}ME", caps[0])
        self.assertIn("{\\c&H00FFE500&}BOT", caps[1])

    def test_custom_font_and_colours(self):
        text = build_ass(dict(SPEC, font="Inter Black", colors={"active": "#00FF00"}), [w("go", 0, 0.3)])
        self.assertIn("Style: Cap,Inter Black,74,", text)
        self.assertIn("{\\c&H0000FF00&}GO", text)

    def test_variant_bar_and_cap_edit(self):
        spec = dict(SPEC, cap_edit=[[0.0, 0.2, "MAIN"]],
                    variants={"b": {"bar": "Other opening", "cap_edit": [[0.5, 0.7, "EDIT"]]}})
        words = [w("one", 0.1, 0.3), w("two", 0.5, 0.7)]
        main = build_ass(spec, words)
        self.assertIn("{\\c&H0000E5FF&}MAIN", main)
        var = build_ass(spec, words, variant="b")
        self.assertIn("OTHER OPENING", events(var, "Bar")[0])
        self.assertIn("ONE", var)                                     # main cap_edit does not apply to the variant
        self.assertIn("EDIT", var)
        self.assertNotIn("MAIN", var)

    def test_translation_events(self):
        text = build_ass(SPEC, [w("english", 0.0, 0.5)], lang="es")
        self.assertIn("LA DEMO LLEGA AL LIMITE", events(text, "Bar")[0])
        labels = events(text, "Label")
        self.assertTrue(labels[0].endswith("AL DIA SIGUIENTE"))         # by label index
        self.assertTrue(labels[1].endswith("BAJO"))                     # by label text
        tr = events(text, "CapTr")
        self.assertEqual(len(tr), 1)
        self.assertTrue(tr[0].endswith("una frase traducida\\Nbastante larga aqui"))
        self.assertEqual(events(text, "Cap"), [])                       # no source-language word captions

    def test_unknown_language(self):
        with self.assertRaises(ValueError):
            build_ass(SPEC, [], lang="fr")

    def test_skips_zero_length(self):
        words = [w("a", 1.0, 1.2), w("b", 1.0, 1.3)]
        caps = events(build_ass(SPEC, words), "Cap")
        self.assertEqual(len(caps), 1)


class LoadWords(unittest.TestCase):
    def test_both_formats(self):
        d = tempfile.mkdtemp()
        p1 = os.path.join(d, "whisper.json")
        with open(p1, "w") as f:
            json.dump({"segments": [{"start": 0, "end": 1, "words": [{"word": " hi", "start": 0.1, "end": 0.3}]}]}, f)
        p2 = os.path.join(d, "flat.json")
        with open(p2, "w") as f:
            json.dump([{"w": "hi", "s": 0.1, "e": 0.3}], f)
        self.assertEqual(captions.load_words(p1), captions.load_words(p2))
        self.assertEqual(captions.load_words(p1), [{"w": "hi", "s": 0.1, "e": 0.3}])


class Round3(unittest.TestCase):
    """Third review round: an empty title bar, braces in text."""

    def test_empty_bar_has_a_font_size(self):
        self.assertEqual(bar_font_size(""), 74)
        self.assertEqual(bar_font_size("\n"), 46)

    def test_ass_text(self):
        self.assertEqual(captions.ass_text("a {b} c\nd"), "a \\{b\\} c\\Nd")

    def test_braces_are_shown_not_read_as_override_tags(self):
        spec = dict(SPEC, bar="props {id}\nline", labels=[{"at": 1.0, "dur": 2.0, "text": "{x: 1}"}])
        spec["translations"] = {"es": {"bar": "el {id}", "caps": [[0, 2.0, "usa {llaves} aqui"]],
                                       "labels": {"0": "{x: 2}"}}}
        words = [w("call", 0.0, 0.3), w("f({a})", 0.4, 0.8)]
        for lang in (None, "es"):
            text = build_ass(spec, words, None, lang)
            for line in events(text):
                body = line.split(",", 9)[9]
                self.assertTrue(body.startswith("{\\pos("), line)
                # every other "{" opens a colour tag or is escaped
                rest = body[body.index("}") + 1:].replace("\\{", "").replace("\\}", "")
                import re
                self.assertEqual(re.sub(r"\{\\c&H[0-9A-F]+&\}", "", rest).count("{"), 0, line)
                self.assertEqual(re.sub(r"\{\\c&H[0-9A-F]+&\}", "", rest).count("}"), 0, line)
        en = build_ass(spec, words)
        self.assertIn("PROPS \\{ID\\}\\NLINE", events(en, "Bar")[0])
        self.assertIn("\\{x: 1\\}", events(en, "Label")[0])
        self.assertIn("F(\\{A\\})", events(en, "Cap")[-1])
        es = build_ass(spec, words, None, "es")
        self.assertIn("usa \\{llaves\\} aqui", events(es, "CapTr")[0])
        self.assertIn("\\{x: 2\\}", events(es, "Label")[0])


class Round4(unittest.TestCase):
    def test_ass_text_line_ends(self):
        self.assertEqual(captions.ass_text("a\r\nb\rc\nd"), "a\\Nb\\Nc\\Nd")

    def test_wide_layout_escapes_braces_too(self):
        import compile_wide
        import re
        spec = dict(SPEC, translations={"es": {"bar": "el {id} de la demo", "caps": [[0, 2.0, "usa {llaves} aqui"]]}})
        marks = [(0.0, 4.0, "props {id} in a long title bar")]
        words = [w("call", 0.0, 0.3), w("f({a})", 0.4, 0.8)]
        for text in (compile_wide.build_wide_ass(marks, words),
                     compile_wide.build_wide_ass(marks, words, [spec], "es")):
            for line in events(text):
                body = line.split(",", 9)[9]
                rest = body[body.index("}") + 1:].replace("\\{", "").replace("\\}", "")
                self.assertEqual(len(re.findall(r"[{}]", rest)), 0, line)
        en = compile_wide.build_wide_ass(marks, words)
        self.assertIn("\\{ID\\}", "".join(events(en, "Bar")))
        self.assertIn("F(\\{A\\})", events(en, "Cap")[-1])
        es = compile_wide.build_wide_ass(marks, words, [spec], "es")
        self.assertIn("\\{ID\\}", "".join(events(es, "Bar")))
        self.assertIn("usa \\{llaves\\} aqui", events(es, "Cap")[0])


if __name__ == "__main__":
    unittest.main()
