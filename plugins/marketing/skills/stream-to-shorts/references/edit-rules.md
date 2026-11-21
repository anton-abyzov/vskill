# Edit rules, shorts mode

Edit rules for a short cut from a live stream: what to keep, what to cut, and the numbers every master must meet.

## These rules replace the takes rule for live-stream clips

The takes rule says: keep each take whole, remove no silence or filler words, and speed up by about 1.1x at most. It is written for scripted recordings with retakes, where the repeated passages are the thing to cut.

A live stream has no retakes. Under the takes rule the whole stream counts as one take, so nothing inside it could be tightened and the dead air stays in. For clips cut from a live stream, use the rules in this file instead.

Scripted recordings with retakes keep the takes rule. Do not apply these rules to them.

## What these rules changed

An earlier batch was cut without these rules, under the takes rule. A later run used them. These are results of that run, not targets.

| Measure | Batch without these rules | Run with these rules |
|---|---|---|
| Length | 36 to 41 s | 7 to 18 s |
| Longest shot | 10.8 to 36.5 s | 1.4 s |
| Spoken words a minute | 97 to 141 | 147 to 178 |
| First spoken word | after a beat | 0.0 s |
| Opening frame | a product diagram | a face plus the moment itself |

Basis tags: [M] measured on reference shorts (a November 2026 sample of 15 outlier shorts: 7 talking AI-coding clips and 8 gaming clips), [V] vendor or practitioner claim, [C] our choice.

## The opening

1. First spoken word at 0.0 to 0.2 s, mid-sentence, on the line that matters. [M] almost every reference short speaks at 0.0 s.
2. Never start on "So", "Okay", a greeting or a breath. Start one word later if you have to. [C]
3. Open on a stake, or on an outcome the eye understands with no context: a render, a fail screen, a reaction. [V] practitioner reports of outcome-first hooks; [C] the scope.
4. Never open on a number, a term or a UI that needs explaining. A number at frame 0 with its meaning 5 s later gives the answer before the question. [C], from the batch that flopped.
5. First visual change by 1.0 s: a new subject, a punch-in or a cut. A caption swap does not count. [M] AI-coding median 1.8 s; [C] tighter, because these clips open cold. The cutter splits at 1.45 s by default and does not enforce this: make the first segment 1.0 s or shorter, or set the spec's `shot` to 1.0, and read `first_change_s` in `metrics.json`.
6. Words readable at frame 0: 7 at most, counting everything on screen (title bar, labels, UI text, captions). [C] from the reference frames, which show one short title.
7. No fade-in, no black frame, no logo on the opening frame. [C]

## Pace

| # | Rule | Target | Basis |
|---|---|---|---|
| 8 | Something meaningful changes | at least every 1.5 s | [M] AI-coding visual shot median 0.70 s |
| 9 | Max shot length in the cutter | 1.45 s, alternate shots punched in 1.08x | [C], what the run used |
| 10 | Pauses inside speech | cut to 0.3 s, never over 0.35 s in the master | [C] |
| 11 | Filler words | cut | [C] |
| 12 | Silence ratio, 0.3 s floor, -30 dB | 0.03 or less for talk; 0.10 or less when game action carries the gap | [M] AI-coding median 0.016 (max 0.038); talk-driven gaming 0.000 to 0.085 |
| 13 | Spoken words a minute, after jump cuts | 145 or more for talk; 120 or more for gameplay | [M] gaming 110 to 180; [C] talk floor, because jump cuts remove gaps, not syllables |
| 14 | Hard cuts plus punch-ins a minute | soft target 6 or more | [M] AI-coding 10.3, gaming 8.4; [C] soft, because two gaming hits had no cuts at all |
| 15 | Visual changes a minute at the 0.05 threshold | a floor only, never a pass signal | [C] the batch without these rules already scored 12 to 33 and flopped; word captions alone trip it |

16. Never add a cut only to hit rule 14. Rule 8 is the binding one. [C]
17. A 1.05 to 1.1x speed-up is allowed only when the clip is still under rule 13 after jump cuts and the voice stays natural. Never use a uniform speed-up as the fix for length: 1.1x turns a 2 s pause into 1.8 s. [C]
18. At the 2x zoom cap (see `layout.md`) a punch-in has no room and does nothing. A shot split there is not a visual change; give the segment another subject (the face, a different window). [C], from how the cutter clamps the window.

## Length and ending

19. Cut to the payoff and stop. Usually 7 to 20 s. [C]; [M] gaming median 30 s.
20. 31 to 50 s is a warning, not a ban. Such a clip needs a second beat that escalates. [M] the AI-coding median is 46.5 s, inside that band.
21. Clips with third-party game audio stay at 60 s or less. [V] a claimed Short over 60 s is blocked worldwide.
22. A verbal answer (the verdict, the number, the reveal) lands after 60 percent of the runtime. [C]; [V] a retention drop near 30 s means the payoff came too late.
23. No outro. The last frame loops into the first. Any end card runs 1.5 s or less. [V] loop practice; [C] the cap.

## Sound targets

These are checked on the master. The audio chain that meets them is in `text-and-audio.md`.

- Loudness -14 LUFS integrated, plus or minus 1; true peak -1 dBFS or lower; LRA 11 or less after loudnorm. [M] most reference shorts measure near -14 LUFS; [V] -14 is the common platform playback level.
- No music bed under speech. The room-tone `bed` is quiet noise at about -55 dBFS, not music (see `text-and-audio.md`, rule 41b). [C]

## Cut mechanics

24. One cold-open reorder per clip: the stake first, then back to the setup. The reordered clip must mean exactly what the stream meant. If the order changes the meaning, drop the reorder. [C]
25. Up to 3 windows from the same stream, about the same event, in stream order after the cold open. [C]
26. Audio stays with its own picture, with one exception: a single hook line of up to 3 s may play over the next window's picture, if the meaning holds. [C]
27. When windows are more than 10 minutes apart and the gap matters to the story, show a time-gap label, for example `40 MIN LATER`. [C]
28. Never join moments from different streams into one claim. [C]
29. Join shots with the concat filter, not the concat demuxer, with 10 ms audio fades at each cut, so cut points do not click. [C]
29a. Every shot is a whole number of frames long (30 a second), picture and sound alike. A shot whose length falls between two frames gets a picture a fraction of a frame longer than its sound; the join fills the difference with digital silence, and every cut after it lands later than planned, so labels and mapped captions drift off their shots. The cutter rounds each span down to whole frames, never up into a dropped range or past its `out`, and renders each shot's picture and sound to exactly that length. A source that is not at 30 frames a second, or a slowed shot, runs out of frames before the count is reached; the cutter holds the last frame for the missing one or two, so the sound is never cut short with the picture. [C], from the source run.
29b. A label covers its whole shot, from the frame of the cut to the frame of the next cut. [C]
30. Cut a garbled line. Do not caption a guess of what was said. A line a listener hears clearly and two models read differently is not garbled: it is a judgment (`text-and-audio.md`, rule 13a). [C]
31. If the picture runs in source order under audio that is left unchanged, the sounds under those shots are not from the same second. Avoid it, or disclose it in the clip notes. [C]
32. Keep only lines that add new information. A repeated sentence, a false start or a line that explains a feature goes. [C]

## How the cutter applies them

`cut_short.py plan <spec.json> --out <dir>` prints the shot list without rendering. Read it before every render.

- A segment marked tight is cut on its word timings: words are grouped wherever the gap exceeds 0.3 s, and each group keeps half the gap on each side, so about 0.3 s of pause is left at every join.
- The cutter drops "uh" and "um" on its own. "So" or "okay" at the start of a line, repeated words and false starts are cut by hand, with drop ranges in the spec.
- Each span is rounded down to whole frames and split into shots of about the max shot length, each a whole number of frames (a shot can be one frame over); every second shot is punched in. The max shot is a length on screen: a slowed or sped-up span is split by its length after the speed change. Under one frame (33 ms) is lost at the end of a span. A segment that starts where the one before it ended, on the same picture and sound, carries on from where that one really ended, so nothing is skipped between them.
- Labels are moved onto cuts (rule 29b): the start to the nearest cut, the end to a later cut. A label typed at or past the end of the cut is left out with a note (a variant can be shorter than the cut its labels were typed for).
- A shot that reads past the end of its source still renders to its planned length, on a held last frame over silence. The cutter prints a WARN naming the shot; fix its `in` and `out`.
- The cutter needs an ffmpeg with the `fps`, `tpad` and `trim` filters (4.2 or later).
- The hook-line exception (rule 26) and picture from another time (rule 31) are spec fields. `spec-format.md` names them.

`cut_short.py render <spec.json> --out <dir>` writes the master, `shots.json`, `words.json` and `metrics.json`. `metrics.json` carries length (counted in frames of the cut), the planned length (`planned_s`; the two differ only when a shot is off the frame grid, and the cutter warns), longest shot, cuts a minute, first-word time, words a minute, speech gaps over 0.6 s and where each label landed.

## Measuring a master

Measure with music muted or absent: a music bed above -30 dB hides every gap and makes silence read as 0.0.

| Number | Command |
|---|---|
| Length, longest shot, first word, words a minute | `metrics.json` from the render |
| Silence ratio and visual changes at 0.05 | `python3 <video-pipeline>/scripts/analyze.py <master> --out <dir> --screencast --silence-min 0.3 --silence-db -30` |
| Hard cuts at 0.3 | the same script without `--screencast` |
| Loudness, true peak, speech gaps, words cut too tight | `python3 scripts/audio_check.py <master> --words words.json` |
| Opening frames | the contact sheet from `scripts/sheet.py` at its default opening times (0, 0.5, 1, 2, 3 s) |

33. The frames at 0, 0.5, 1, 2 and 3 s show at least 3 different subjects. This is a human gate; no number replaces it. [C]
34. A number that misses its target is fixed in the cut, not explained away in the notes. A rule broken on purpose is written in the clip notes with the reason. [C]
