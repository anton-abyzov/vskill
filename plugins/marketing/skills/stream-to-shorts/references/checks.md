# Checks before scheduling

Stage 8. Four checks on every master and every translated render, before the first post is created. A clip that fails one is fixed and checked again, or dropped.

## Who checks

The maker checks while cutting. That is not the release check. The release check is run by a reviewer who did not cut the clips: another agent on another model, or a person. Give the reviewer the masters, the burned caption words and the candidate list. Do not give them the maker's notes, scan results or reasons: a reviewer who starts from the maker's conclusion confirms it.

The reviewer writes one finding per line with clip id, time, what was seen or heard, and a level:

| Level | Meaning |
|---|---|
| fix | Must change before the clip is scheduled |
| note | The owner decides: text that is the owner's own and may be fine to show |
| pass | Checked, nothing found. Name what was checked |

Record who ran each check. A check nobody ran is written down as a gap, not as a pass.

## 1. Privacy

```bash
python3 <SKILL_DIR>/scripts/privacy_scan.py clips/a01-demo/a01-demo.mp4 --out checks/a01-demo --engine tesseract
python3 <SKILL_DIR>/scripts/privacy_scan.py clips/a01-demo/a01-demo.mp4 --out checks/a01-demo --engine ocrmac --upscale 2 \
  --extra-pattern "<a name, employer or host to look for>"
```

1. Use a different OCR engine than the maker used, and keep the 2x upscale pass on (the default for `tesseract`; pass `--upscale 2` for `ocrmac`). Small text in a zoomed screen recording is read at 2x and missed at 1x.
2. Read the whole unique-lines file, not only the flagged lines. The patterns flag emails, handles, URLs, paths, addresses, long digit runs, code-like groups and credential words. A client name, a project name or a person's name has no pattern.
3. Look at frames, not only at text. In the source run the items an OCR list could not show were found by eye on enlarged crops: a list of projects on a phone screen, an info pane beside the main window, the stream's own chat inside a crossfade frame, and a webcam overlay that had been captured inside the screen recording.
4. Check the screen window's edges. A crop that cuts on-screen text into fragments reads as a mistake and can leave half of a private line.
5. A translated render shows the same picture, so one scan covers the picture. Its text is checked in check 3.

In the source run every privacy finding was at note level, for example the owner's own thread titles and machine names. Every fix-level finding came from the checks below, which no pattern scan can do.

## 2. Captions against the sound, and against the screen

```bash
<your transcriber> clips/a01-demo/a01-demo.mp4      # a second transcript of the finished master, another model than the maker's
python3 <SKILL_DIR>/scripts/caption_check.py clips/a01-demo/burned.json checks/a01-demo/independent.json
python3 <SKILL_DIR>/scripts/audio_check.py clips/a01-demo/a01-demo.mp4 --words clips/a01-demo/words.json
```

`burned.json` is what the cutter burned, after the spec's fixes. `caption_check.py` lists every difference with its time and marks numbers and capitalised words CHECK BY EAR.

1. **Listen to every name, brand, model and number.** Two speech models can agree with each other and both be wrong. In the source run both heard an ordinary word as a company name, and both got product names wrong. Only a listen settles these.
2. **Compare captions with the screen, not only with the speech.** A caption can repeat the speaker exactly and still be wrong: the speaker names one model while the screen shows another, or says a number that the screen contradicts. A slip of the tongue that the picture disproves is cut or corrected with a label. Never caption it as fact.
3. **A missing line.** Compare line counts between the original and each translated render. One translated render in the source run had lost a caption line the original had.
4. **Dropouts.** `audio_check.py` lists stretches near digital silence with sound on both sides. They come from a jump cut with no room tone, a noise gate, or a separated voice stem, and they play as a glitch. In the source run they ran 0.3 to 1.0 s on clips whose loudness was in range. Fill them with room tone from the same recording, or loosen the cut.
5. **Words that dip.** `audio_check.py --words` lists every word that has a 50 ms window under -50 dBFS inside it. In the source run these were words about 30 dB under the speech around them and words whose start a cut had clipped. Listen to each; widen the cut by a few frames.
6. **First word.** `metrics.json` and `audio_check.py` give its time. Some clips in the source run opened 0.7 to 2.0 s late. Over 0.2 s is a re-cut.

## 3. Native read of translated text

A native speaker of the target language reads every translated title bar, label and caption line against the original. A model that is strong in the language may do a first pass; it does not replace the reader unless the owner says so, and the record says who read it.

What the read found in the source run:

- grammatical gender that did not match the speaker;
- word-for-word calques of idioms;
- a line whose meaning was reversed;
- tokens left untranslated in the middle of a line;
- number and unit formats of the source language;
- a title that could be read two ways.

## 4. Honesty: every title against the picture

1. List every claim the clip makes in text: the title bar, each label, the post title and the post caption.
2. For each, find the frame that proves it. Use the candidate's "what the shot proves" and the census.
3. **Read the clip with the sound off.** The title bar stays up for the whole clip. If the picture under it shows something else for part of that time, the bar is wrong for that part: change the bar, the window or the cut.
4. **Check each label's timing against the cut it belongs to.** A label that appears a few frames before its cut sits over the previous picture and labels the wrong thing. Start it on the cut.
5. **Check what each label covers.** A label that sits over an on-screen heading hides it and can rename what the viewer sees.
6. A claim with no frame behind it is rewritten to what the footage shows, or the clip is dropped. A stream's title is not evidence.
7. Third-party footage inside the capture (a trailer, another creator's video, licensed game cutscenes) is a rights note for the owner, with its time.

## What the independent check caught that the maker's scan missed

The maker ran a pattern OCR scan and a music tagger on every clip and both came back clean. The independent check then found, on the same files:

| Class | Why the maker's scan could not see it |
|---|---|
| A caption crediting a model the screen does not show | The scan reads the picture and the captions separately |
| Wrong names and brands in captions | Both speech models heard them the same wrong way |
| A caption repeating a slip of the tongue the screen contradicts | The caption matched the speech |
| Dropouts at jump cuts and in gated voice stems | Loudness, peak and the tagger were all in range |
| Words far quieter than their neighbours, clipped word starts | Same |
| A label a few frames early, over the wrong picture | Needs a frame-by-frame look at each cut |
| A title bar over footage of something else | Needs a sound-off read |
| A label covering and renaming an on-screen heading | Needs a look at the frame |
| Translation errors and a lost caption line | Needs a reader of the language |
| A stray webcam overlay inside the screen recording; text cut to fragments at the window edge | Not text a pattern matches |
| Late first words | The number was in `metrics.json`; nobody had held it against the 0.2 s target |

So the release check is a look, a listen and a read, by someone else. The scripts shorten that work. They do not do it.

## Output

`checks/<clip>/`: both OCR lists, the independent transcript, the `caption_check.py` and `audio_check.py` output, the contact sheet, and a `review.md` with the findings, the reviewer and what was not checked. A clip moves to `checked` in `batch.json` when it has no open fix.
