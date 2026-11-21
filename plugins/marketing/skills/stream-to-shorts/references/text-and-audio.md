# Captions, titles and audio

Text and sound on a short cut from a stream: captions, the title bar, labels, hook variants, translated versions and the audio chain.

Basis tags: [M] measured on reference shorts (a November 2026 sample of 15 outlier shorts: 7 talking AI-coding clips and 8 gaming clips), [V] vendor or practitioner claim, [C] our choice. Positions are in `layout.md`; this file covers what the text says and how it looks.

## Captions

| # | Rule | Value | Basis |
|---|---|---|---|
| 1 | Unit | word by word, in groups | [M] the reference shorts swap captions every 0.3 to 0.5 s |
| 2 | Group size | up to 3 words or 13 characters | [C] |
| 3 | New group | on a gap over 0.4 s, or after a word that ends a sentence | [C] |
| 4 | Active word | highlighted in yellow; the rest of the group in white | [C] |
| 5 | Second speaker | a second highlight colour (cyan), for an AI voice or a guest | [C] |
| 6 | Look | bold heavy sans, 74 px, white, dark outline 7 px with a soft shadow | [C] |
| 7 | Case | upper case; a trailing comma or full stop is dropped | [C] |
| 8 | Timing | each word shows from its start to the next word's start; the last word of a group holds up to 0.3 s past its end | [C] |

9. Caption words come from a transcript of the cut, not of the stream. `cut_short.py render <spec.json> --out <dir>` runs the transcription command (`--transcribe-cmd` or `STS_TRANSCRIBE`) on the cut audio and writes `words.json` in cut time. Without one it maps the stream transcript through the shot timeline, which carries that transcript's errors; `metrics.json` says which source was used. [C]
10. A transcript needs an ear for names and numbers. Listen to every name, number and product word against the master before the burn. [C]
11. Fix wrong words in the cut spec, never in `words.json` by hand:
    - the `fix` map replaces a word everywhere it appears (an exact match first, then the lower-case form);
    - a timed edit in `cap_edit`, `[start, end, text]`, replaces the words that start inside that cut-time range;
    - an empty timed edit removes the word.
    A hook variant carries its own `cap_edit`. `spec-format.md` has the full spec.
12. After a fix, re-burn without transcribing again: `cut_short.py finish <spec.json> --out <dir>`. [C]
13. Check the burned captions against an independent transcript of the master: `python3 <SKILL_DIR>/scripts/caption_check.py <dir>/burned.json <independent-words.json>`. The cutter writes `burned.json`, the words after the spec's fixes, next to the master. Every difference is either a fix or a note. Then compare the captions with the screen as well: a caption that repeats a slip of the tongue the picture contradicts is wrong (`checks.md`). [C]
14. Captions say what was said. A garbled line is cut from the clip, not captioned as a guess (`edit-rules.md`). [C]

Example of a fix: the transcript hears "for tea" where the speaker said "40". A fix map entry `"tea": "40"` is wrong, because it changes every "tea" in the clip. A timed edit over the 0.2 s where the number is spoken is right.

## Title bar

15. 3 to 6 words, an outcome or a stake, in upper case. [C]; [M] the reference shorts keep one short title on screen.
16. On screen from 0.0 s to the last frame. [M]
17. Names a brand the viewer already knows, if one is in the picture. Never a product the viewer has not heard of. [C]
18. Describes what the picture shows. A title that the picture does not prove is a reject. [C]
19. Every clip gets its own wording. A batch that looks templated risks being judged repetitive under YouTube's inauthentic-content policy. [V]
20. No product pitch in the title bar or in the first 5 s. A product name belongs in the description or a spoken mention after 5 s. [C]
21. Black text on the white bar. The cutter sizes it to fit 780 px: 74 px at most on one line, 46 px on two lines, smaller when the line is long. A single line over about 20 characters already shrinks below 74 px, which is one more reason to keep it to 6 words. [C]

Examples, made up: `MY TEST SUITE WENT RED` (a stake, 5 words). `THE BUILD FINISHED IN 4 MINUTES` is a number that needs context at frame 0; move the number to the payoff and open on the stake.

## Labels

22. A label is a short on-picture note that says what a thing is: `AI-BUILT DEMO, NOT THE REAL GAME`, `40 MIN LATER`, `SAID ON STREAM`. [C]
23. White text on a red box, 50 px, timed by start and duration in the spec. [C]
24. A label that is on screen at frame 0 counts toward the 7-word limit. [C]
25. Use a label when the picture alone would mislead: an AI-built demo that looks like a commercial game, a price said on stream, two windows far apart in time. [C]

## Hook variants

26. An alternate opening changes the first seconds and may change the title bar. It is rendered from the same spec: `cut_short.py render <spec.json> --variant <name> --out <dir>`. [C]
27. A variant is not a second post. Hold it until the first version's 72-hour read, then run it only on accounts where the first version did not run. [C]
28. In the run, alternate openings were scheduled as their own posts, with the same title bar as the first version. They would have read as reposts and were deleted before they went live. [C]
29. Test one variable at a time: face or screen at frame 0, pain or stake wording. Both versions keep speech at 0.0 s and every rule in `edit-rules.md`. [C]
30. Call a winner only with 300 or more plays per variant and 8 points or more of difference in 3 s skip rate. At 100 plays per variant the 95 percent interval on the difference is about plus or minus 13 points, so a smaller test is noise. Otherwise log "no difference" and keep the first version. [C], from the binomial interval.
31. Pool results by hook type across clips. Never decide a hook type from one or two tests. [C]

## Translated versions

32. A translated version is a separate render: the title bar, labels and captions are translated, the voice is unchanged. The text comes from the spec's `translations` entry for that language code: `cut_short.py finish <spec.json> --lang es --out <dir>`. [C]
33. Translated captions are phrases timed to the speech, not word by word, because the words do not line up across languages. The cutter sets them smaller (50 px) and wraps them. [C]
34. Translate by meaning, not word for word. Keep the title bar inside 3 to 6 words in the target language. [C]
35. Never repost the original file to a second-language account. [V] platforms demote reposted and recycled content.
36. A native speaker reads every translated line before the first post. In the run no translated line had been read by a native speaker when the schedule was built; record that as a gap, not a pass. [C]

## Burning the text

All text is burned into the master as an ASS subtitle file with libass. The title bar's white box is drawn in the same pass.

- The ffmpeg build must have the `ass` filter. Check with `ffmpeg -hide_banner -filters` and look for ` ass `. Many packaged builds lack it.
- `cut_short.py` checks for the filter before it renders and stops with a one-line reason if it is missing. Point it at a build that has it with `--ffmpeg` or `STS_FFMPEG`.
- Title bar sizes are computed for a heavy sans (Arial Black in the run). Check the contact sheet that the bar text fits; an ffmpeg build that needs a font config takes one through `--fontconfig`.

## Audio

37. Voice first. Game sound and other speakers sit under the voice. [C]
38. Before loudness: `highpass=f=70` and a light `afftdn` denoise (the run used `nr=8:nf=-45`), checked by ear on the first clip. Raising quiet stream audio by several dB also raises the room noise. [C]
39. Two-pass loudnorm to -14 LUFS: measure first, then apply with the measured values (`I=-14:TP=-1.5:LRA=11`, `linear=false`), then a limiter. The filter aims at -1.5 dBFS true peak so the encoded master measures -1 dBFS or lower. [V] -14 LUFS playback level; [C] the margin.
40. A 50 ms fade at the very last frame stops a click on loop. It is not a fade-out. [C]
41. Check the master: `python3 <SKILL_DIR>/scripts/audio_check.py <master> --words words.json`. It reports loudness, true peak, silences, speech gaps, clipped samples, dropouts and words whose audio dips because a cut sits too tight. [C]
41a. No digital silence inside a clip. A jump cut, a noise gate or a separated voice stem can leave a hole with no room tone, and it plays as a glitch even when loudness is in range. The run had holes of 0.3 to 1.0 s that only an independent listen found. Lay room tone from the same recording under the whole clip, or loosen the cut, and use `gate` only where the noise is worse than the hole. [C]
42. No music bed under speech. [C]
43. Where music already sits under speech in the source (game menus, radio, a score, cutscenes), do one of three things: take the voice from a separated vocals stem for that span (for example with demucs) and say so in the clip notes; mute the span; or pick another window. [C]
44. Check every window with `<SKILL_DIR>/scripts/music_check.py` and a listen. A tagger score is not a listen. In the run no clip had been listened to by a person when the schedule was built; record that as a gap, not a pass. [C]
45. Third-party game audio and music draw copyright claims. Keep such clips at 60 s or less, and upload as private first where the platform shows a claim check before publishing. [V] a claimed Short over 60 s is blocked worldwide.
