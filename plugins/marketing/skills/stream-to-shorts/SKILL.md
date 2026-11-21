---
name: stream-to-shorts
description: "Turn a multi-hour livestream or other unscripted recording into many fast vertical shorts. Covers a census of what the stream really contains, scored moment mining, shorts-mode cuts (speech at 0.0 s, pauses cut to 0.3 s, a change on screen every 1.5 s), a stacked layout (face, title bar, full-bleed screen), word-by-word captions, voice-first audio, per-platform exports, independent checks before scheduling, a spaced schedule and a retention log. Ships scripts for the cut, captions, contact sheets, layout, privacy, audio and caption checks, exports, a schedule planner and a post helper that redacts credentials. Use for 'cut shorts from my stream', 'clips from this VOD', 'reels from the livestream', 'my shorts are too slow'. Not for scripted recordings with retakes (hyperframes-best-practices), one designed reel (hyperframes) or one long video (video-pipeline)."
metadata:
  version: "1.0.0"
  author: Anton Abyzov
  category: marketing
  tags: video, shorts, livestream, vertical, captions, ffmpeg, whisper, scheduling, retention, privacy
---

# stream-to-shorts

One long stream in, many short vertical clips out, each cut for the feed and checked before it is scheduled.

**These edit rules replace the takes rule for clips cut from a live stream.** The takes rule (keep each take whole, no silence or filler removal, a uniform speed-up of about 1.1x at most) is for scripted recordings with retakes, and those keep it. A live stream has no retakes, so under that rule the whole stream is one take and nothing can be tightened. Here pauses and filler words are cut.

The method comes from a production run in November 2026: 15 clips and 2 compilations from two streams. Against the batch it replaced, clips went from 36 to 41 s down to 7 to 18 s, the longest shot from 10.8 to 36.5 s down to 1.4 s, and speech from 97 to 141 up to 147 to 178 words a minute, with the first word at 0.0 s. The mistakes of that run are rules below.

## Stages

Work in this order. A stage is done when its file exists.

| # | Stage | Leaves behind | Reference |
|---|---|---|---|
| 1 | Intake and census | source file, word transcript, `census.md` | this file |
| 2 | Mine moments | `candidates.md` | this file |
| 3 | Cut, shorts mode | `specs/<clip>.json`, master, `metrics.json` | `references/edit-rules.md`, `references/spec-format.md` |
| 4 | Layout | the same master, a contact sheet | `references/layout.md` |
| 5 | Captions, titles, hook variants | caption fixes in the spec | `references/text-and-audio.md` |
| 6 | Audio | loudness in `metrics.json`, listen notes | `references/text-and-audio.md` |
| 7 | Exports per platform | one file per preset | `references/platform-specs.md` |
| 8 | Checks before scheduling | `checks/<clip>/`, a review note | `references/checks.md` |
| 9 | Schedule | `plan.json`, `receipts.jsonl` | `references/scheduling.md` |
| 10 | After publishing | `retention-log.csv` | `references/retention.md` |

Keep everything for one stream in `shorts/<source-id>/`, with `batch.json` as the record: one entry per clip, keyed by source id, start and end, with a status of `candidate`, `cut`, `checked`, `approved`, `scheduled`, `live` or `measured`. On pickup read it first and continue from the first clip that is not finished.

Scripts live in `<SKILL_DIR>/scripts/`. They need `python3` and `ffmpeg`; the caption burn needs an ffmpeg built with libass (`cut_short.py` checks and says so). Only `posts.py` talks to a posting service. It creates or changes nothing without `--go`; a dry run still reads the scheduler's queue, and `upload` sends a file.

## 1. Intake and census

1. **Ownership.** Search the project's threads, reports and notes for the exact source video id before doing anything. If another thread already owns that stream, use its masters and receipts. The duplicate key is source id plus start and end: a second clip from the same stream is new work, the same window twice is not.
2. **Download once, at best quality.** List formats first, then take the best video and audio:
   ```bash
   yt-dlp -F "<url>"
   yt-dlp -f "bv*+ba/b" --merge-output-format mp4 -o "src/%(id)s.%(ext)s" "<url>"
   yt-dlp --skip-download --write-auto-subs --write-subs --sub-langs "en.*,live_chat" --sub-format json3 "<url>"
   ```
   Captions and a chat replay may be missing on a fresh upload; check again later before relying on their absence. Only cut streams you own or have the right to cut.
3. **Word-level transcript of the whole stream**, once, with word timestamps (any Whisper build: `--word_timestamps True --output_format json`). Every later step reads this file.
4. **Census before any clip is framed.** Write `census.md`: what the stream's title and plan promised, then what is really in the footage. One row per promised element or notable event: time, what happened or was said, whether it is audible or on screen, the evidence (an overlay, a tally, a screen), the outcome within 60 s, and whether music is playing.

   The reason: in the source run one stream's title promised AI orders and audience votes. The census found no usable order, no vote overlay and no chat replay. Every clip from it was then framed as what happened, and none says an order was given or a vote was held. Never invent a stake, and shrink a stream's share of the batch when the census finds less than planned.

## 2. Mine moments

Find candidates from the transcript, then confirm each one in the picture.

```bash
python3 <SKILL_DIR>/scripts/words.py transcript.json --grep "look at this,oh my,no way,what,limit,failed,first time" --context 8
python3 <SKILL_DIR>/scripts/words.py transcript.json 4795-4812          # read one window word by word
python3 <SKILL_DIR>/scripts/sheet.py src/VIDEO_ID.mp4 sheets/c01.jpg --times 4796,4799,4802,4806
```

Search for reactions, failures, limits, prices and numbers, and first times. Where a chat replay exists, a burst of messages marks a moment too. Open the contact sheet and look: the transcript says what was said, only the frames say what was shown.

Write `candidates.md` with one row per candidate:

| Field | What goes in it |
|---|---|
| id, windows | clip id and up to 3 source windows about the same event |
| line at 0.0 s | the words the clip opens on |
| what the shot proves | what is visibly on screen that backs the title: which app or device, which result, the stream date |
| stands alone | can a stranger follow it with no stream context |
| risks | private text in the crop, music, a claim the footage does not show |
| score | 0 to 10, from the rubric below |

Score: a stake or an outcome visible in the first 1.5 s (0 to 3), the result on screen and not only described (0 to 3), a subject or brand the viewer already knows (0 to 2), clean audio and no private text (0 to 2). Cut the candidates at 6 or more, 10 to 20 per stream. A moment that needs explaining is dropped, however good it felt live. A second model reading the candidate list before any render is cheap and caught weak picks in the source run.

## 3. Cut, shorts mode

Targets, each with its basis, are in `references/edit-rules.md`. The ones that bind every clip:

- First spoken word at 0.0 to 0.2 s, mid-sentence on the line that matters.
- Open on a stake, or on an outcome the eye understands with no context. Never on a number, a term or a UI that needs explaining.
- A new subject, a punch-in or a cut by 1.0 s, and something meaningful changes at least every 1.5 s. A caption swap does not count. The cutter splits shots at 1.45 s, so the 1.0 s rule is yours to meet: make the first segment 1.0 s or shorter, or set the spec's `shot` to 1.0.
- Pauses inside speech cut to 0.3 s, filler words cut, no uniform speed-up as the fix for length.
- 145 or more spoken words a minute for talk after the cuts, 120 or more for gameplay.
- Cut to the payoff and stop, usually 7 to 20 s. No fade-in, no outro.

Each clip is one JSON spec (`references/spec-format.md`):

```bash
python3 <SKILL_DIR>/scripts/cut_short.py plan   specs/a01-demo.json --out clips/a01-demo     # shot list, no render
python3 <SKILL_DIR>/scripts/cut_short.py render specs/a01-demo.json --out clips/a01-demo     # master + shots, words, metrics
python3 <SKILL_DIR>/scripts/cut_short.py finish specs/a01-demo.json --out clips/a01-demo     # re-burn text after a caption fix
```

Read `metrics.json` after every render: first word time, first change (`first_change_s`), longest shot, words a minute, speech gaps, loudness. One cold-open reorder per clip is allowed, and the reordered clip must mean exactly what the stream meant.

## 4. Layout

1080x1920, top to bottom: the face across the full top (y 0 to 640), a title bar (y 640 to 760), the screen or game filling the rest edge to edge (y 760 to 1920), cropped to a window that follows the action. Word-by-word captions sit over the lower part of the face panel. Geometry, the full-frame layout for moments with no facecam, and the zoom cap are in `references/layout.md`.

**Safe zones limit text only.** Captions, the title bar and labels stay inside the text-safe box. The picture fills the whole frame, including the part of it under the platform's buttons.

**Named reject: empty bottom.** The first render of the source run left the bottom third of every frame empty, a letterboxed screen with blurred fill under it, because the safe zone was read as a limit on picture. Every clip was re-rendered. Check each master:

```bash
python3 <SKILL_DIR>/scripts/fill_check.py clips/a01-demo/a01-demo.mp4
python3 <SKILL_DIR>/scripts/sheet.py clips/a01-demo/a01-demo.mp4 checks/a01-demo/open.jpg     # frames at 0, 0.5, 1, 2, 3 s
```

`fill_check.py` exits 1 when the bottom of the frame is empty. On the source run it failed all 12 letterboxed renders and passed all 32 fixed ones. It is a hint: a detailed blur that reaches the bottom edge would pass, so look at the sheet as well. There, also check for at least 3 different subjects in those five frames and at most 7 readable words at frame 0. The other named rejects are in `references/layout.md`.

## 5. Captions, titles, hook variants

- Captions are the words of the cut, word by word, active word highlighted. The words come from a transcript and need an ear for names and numbers: correct them in the spec, and cut a garbled line instead of captioning a guess.
- The title bar is 3 to 6 words, on screen from the first frame to the last, and says what the picture shows. Every clip gets its own wording.
- **An alternate opening is not a second post.** A hook variant changes the first seconds of the same clip. Hold it until the first version's 72-hour read, then run it only where the first did not run. The source run scheduled variants as separate posts; that is the mistake this rule fixes.
- A translated version is a separate render with translated title bar and captions. A native speaker reads every line before it is scheduled.

Details: `references/text-and-audio.md`.

## 6. Audio

Voice first. The cutter runs a high-pass, a light denoise and two-pass loudness normalisation to -14 LUFS with true peak at or under -1 dBFS; check the denoise by ear. Where music sits under speech (a game menu, radio, a score), take the voice for that span from a separated vocals stem, mute the span, or pick another window, and note it in the clip's record.

```bash
python3 <SKILL_DIR>/scripts/audio_check.py clips/a01-demo/a01-demo.mp4 --words clips/a01-demo/words.json
python3 <SKILL_DIR>/scripts/music_check.py src/VIDEO_ID.mp4 4795-4812 --model yamnet.tflite
```

`audio_check.py` also lists dropouts: holes of digital silence left by a cut, a gate or a voice stem. They play as glitches while every loudness number is in range.

**A tagger score is not a listen.** A low music score clears nothing. Someone, a person or a second model that takes audio, listens to every master before the first post. Record who listened; "nobody yet" is a recorded gap, not a pass.

## 7. Exports

One master covers most surfaces. Presets, limits, text-safe zones and what each platform ranks on are in `references/platform-specs.md`, each number with its source and the date it was read.

```bash
python3 <SKILL_DIR>/scripts/export.py clips/a01-demo/a01-demo.mp4 --preset P1 --out exports/a01-demo
python3 <SKILL_DIR>/scripts/export.py clips/a01-demo/a01-demo.mp4 --preset P5 --out exports/a01-demo   # size-capped
```

The 4:5 preset (P3) crops the 9:16 master; in the stacked layout its default crop cuts the top of the face panel, so set `--crop-y` and look at the result.

Render every platform's file from your own master. Never post a file downloaded from another platform, never burn a watermark, never the same file twice on one account.

## 8. Checks before scheduling

All four, on every master and every translated render, before the first post is created. Method and commands: `references/checks.md`.

1. **Privacy scan by an independent reviewer.** The maker's own scan is not the release check. A different agent, one that did not cut the clips, reads text off every frame with a different engine and reads the whole list, not only the flags.
2. **Transcript against captions.** The reviewer transcribes the finished master again and compares it with the burned captions (`caption_check.py` on the cutter's `burned.json`). Names and numbers are checked by ear, and captions are compared with the screen too: a caption can match the speech and still contradict the picture.
3. **Native read of translated text.** Every translated title bar and caption line.
4. **Honesty check of every title against the picture.** Each title bar, label, post title and caption claim is compared with "what the shot proves" from stage 2 and with the census, and the clip is watched once with the sound off. A title the footage does not show is rewritten or the clip is dropped.

In the source run the maker's own OCR scan and music tagger came back clean on every clip. The independent check then found captions that credited a model the screen did not show, names both speech models had heard wrong, silent holes at jump cuts, labels a few frames early over the wrong picture, and translation errors. `references/checks.md` lists the classes and why a scan cannot see them.

## 9. Schedule

Which account gets which clip, the account ids and the approval rules belong to `social-media-posting`. This skill holds no account ids. It plans times and guards the queue.

```bash
python3 <SKILL_DIR>/scripts/plan_schedule.py clips.json accounts.json --busy busy.json --tz America/New_York --out plan.json --calendar calendar.csv
python3 <SKILL_DIR>/scripts/posts.py --backend postiz create plan.json --receipts receipts.jsonl          # dry run; add --go to create
```

- The planner keeps at least 6 hours between posts on one account, respects quiet hours and any rolling cap you give it (for example a scheduler plan that allows 3 short-video posts in 24 hours), counts what is already queued and never moves it, and gives a hook variant no slot until it is released.
- Changes after creation are in-place updates of this batch's own queued posts only. The helper refuses a post id that is not in this batch's receipts, and skips a post the scheduler does not report as queued.
- A time that is not in the future is never sent: most schedulers would publish it at once.
- **Never print credential fields.** In the source run a post lookup returned the scheduler's whole account object and put part of an API key and OAuth tokens into tool output. So: read posts only through `posts.py`, which prints an allowlist of fields as plain values; pipe any other scheduler output through `redact.py`, which masks by key name, by shape and by known value and is a second line, not a guarantee; never `cat` a credentials file or print the environment. If a secret does reach output, say so and have it rotated.
- Show the calendar and get the owner's approval the way `social-media-posting` requires before any `--go`.

## 10. After publishing

```bash
python3 <SKILL_DIR>/scripts/retention_log.py init plan.json retention-log.csv
python3 <SKILL_DIR>/scripts/retention_log.py decide retention-log.csv --account yt-main --baseline-views 100 --plan plan.json
```

After each fire time, confirm the post is live on the right account with the right file and title, and record its URL. Read the numbers at 24 and 72 hours and let the decision rule say what happens next: double down on a winner, give a loser a new first 2 seconds on platforms where it has not run, release or drop a held variant. Judge the format after 20 to 30 clips, not after one; the only earlier stop is a median viewed vs swiped under 60% after 10 posts. `references/retention.md` has the columns and the rule.

## Inside SpecWithCode

These apply when the `studio-code` tools are present.

- One thread owns one stream's batch; `batch.json` and the receipts let another thread or machine continue it.
- The independent check in stage 8 runs in a separate thread on another model, with the masters only and none of the maker's notes.
- Renders and whole-stream transcription can run on another machine; move sources and masters with `studio_file_transfer`.
- Approval gates use `ask_user`. Credentials are requested with `request_secret`, never pasted into chat.

## What is not automatic

- The screen window is set by hand per segment from a contact sheet. Nothing tracks the action.
- `fill_check.py`, the privacy flags and the music score are hints. A person or a second model still looks, reads and listens.
- `posts.py` is a port of the scheduler calls that ran in the source run, tested here against a fake transport only. Dry-run it against your own scheduler before the first `--go`. It updates or deletes a post only when the scheduler's lookup reports state `QUEUE` (the source run's scheduler did, on every update); the id field of a Blotato create response is unconfirmed, so a Blotato delete may find nothing and skip.
- Redaction errs toward masking: a line such as `token: expired` prints as `token: [redacted]`. The HTTP status is always printed.
- The retention log is filled by hand from each platform's analytics screen.

## Done when

- Every clip in `batch.json` is `measured`, or carries the reason it stopped earlier.
- Each master met the stage 3 targets in its `metrics.json`, passed `fill_check.py` and the contact sheet, and passed the four checks in stage 8 with the reviewer named.
- Every scheduled post is in `receipts.jsonl`, was verified live, and has its 24 and 72 hour reads in the retention log.
