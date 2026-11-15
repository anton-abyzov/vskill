---
name: video-pipeline
description: "Run a video from raw footage or a brief to a delivered file as one ordered pipeline: intake, measure, cut, source and generate assets, build graphics, assemble and master, deliver. It routes each stage to the skill that owns it (hyperframes and its sub-skills, hyperframes-best-practices, media-use, general-video, motion-graphics, product-launch-video, kie-gemini-omni, social-media-posting), keeps a per-video stage record so work resumes after a dropped session, and ships a script that measures footage or a reference video (shots, pacing, silences, loudness, frames, word timestamps). Use when the user asks to edit or produce a video end to end, says 'edit this recording', 'make a video from this footage', 'match the pacing of this video', 'analyze this footage', 'what is my video workflow', or names several stages at once. Not for a single stage on its own: a pure motion graphic goes to motion-graphics, a pure recut to hyperframes-best-practices, posting to social-media-posting."
metadata:
  version: "1.0.0"
  author: Anton Abyzov
  category: marketing
  tags: video, editing, pipeline, ffmpeg, whisper, hyperframes, pacing, footage-analysis, specwithcode
---

# video-pipeline

This skill is a router with one tool of its own. It decides the order, names the owner of each stage and holds the gates between them. It does not restate what the owning skills already say: load the owner and follow it. When a rule here conflicts with an owner, the owner wins for its stage, and the user's own editing rules win over both.

## Stages

Skip a stage the video does not need. Never reorder 2 before 3, or 3 before 5: overlays are timed against a locked cut.

| # | Stage | Owner | Leaves behind |
|---|---|---|---|
| 1 | Intake: footage or brief, target length, aspect, destination | this skill | `BRIEF.md`, `.work/pipeline.json` |
| 2 | Measure the footage | `scripts/analyze.py` | `.work/analysis.json`, frames, word transcript |
| 3 | Cut | `hyperframes-best-practices` (recorded takes), `media-use` operations (other footage) | `cuts.json`, `edl.txt`, `master.mp4` |
| 4 | Assets: find, then generate | `media-use` first, `kie-gemini-omni` for generated images and clips | files in `assets/` with their source noted |
| 5 | Graphics and scenes | `hyperframes` picks the route: `product-launch-video`, `general-video`, `motion-graphics` | compositions, `STORYBOARD.md` |
| 6 | Assemble and master | `hyperframes` render, `hyperframes-audio` or `media-use` mixing | `renders/<name>.mp4` |
| 7 | Deliver | `social-media-posting` | the file, its preview, the post once approved |

A video with no footage (a launch film, an explainer, a motion graphic) starts at 1, skips 2 and 3, and enters at 5 through `hyperframes`.

## Stage record

Keep `.work/pipeline.json` in the video's project folder and update it when a stage finishes, before starting the next one:

```json
{"video": "specwithcode-handoff-reel", "stages": {
  "measure": {"status": "done", "artifact": ".work/analysis.json"},
  "cut": {"status": "approved", "artifact": "master.mp4", "note": "6 takes kept, 1.1x"},
  "graphics": {"status": "in_progress"}}}
```

Statuses: `todo`, `in_progress`, `done`, `approved`, `skipped`. On pickup, read this file first and continue from the first stage that is not `done`, `approved` or `skipped`. Never redo an approved stage unless the user reopens it; a recut after approval resets every later stage to `todo`.

## Stage 2: measure before cutting

```bash
python3 <SKILL_DIR>/scripts/analyze.py <footage> --out .work --frames 24 --transcribe
python3 <SKILL_DIR>/scripts/analyze.py <footage> --out .work --screencast --transcribe   # screen recording
```

It needs `ffmpeg` and `ffprobe`; `--transcribe` needs the `whisper` CLI and is skipped with a note when it is missing. It writes `.work/analysis.json`: stream facts, integrated loudness and true peak, silences and speech spans, shots, pacing numbers, and the paths of the saved frames and the word transcript.

Then read it, and look at the frames with your own eyes before proposing anything:

- `notes` lists problems to settle first (no audio, streams of different length).
- `speech_spans` and `silences` locate the takes and the dead air between them. They are for finding boundaries, never for cutting inside a take.
- `shots` on a screen recording marks where the screen changed, which is where an overlay or a zoom usually belongs.
- `loudness` sets the mastering job: the gap to the target in stage 6.
- For recorded takes, the word transcript is the source for grouping repeated attempts. The cut rules live in `hyperframes-best-practices`.

For footage where the picture carries meaning the words do not (a demo with no narration, a screen with small text), sample more frames (`--frames 60`) or read specific moments with `ffmpeg -ss <t> -frames:v 1`. A video-understanding model is an option for long footage; treat what it returns as a draft and check each claim against a frame.

## Matching a reference video

When the user points at a video and says "like this", measure it instead of guessing:

```bash
python3 <SKILL_DIR>/scripts/analyze.py <reference file> --out .work/reference --frames 12
```

Carry the numbers into the brief, not the content: `shot_median_s`, `cuts_per_min`, `first_cut_s`, `silence_ratio`, `words_per_min_spoken` when transcribed, and what the frames show about layout (text position, caption style, how much of the frame the subject fills). State them as targets in `BRIEF.md`, for example "median shot 2.4 s, first cut by 1.5 s, about 170 spoken words a minute".

A reference is something to measure. Its footage, music, graphics, voice and wording stay out of the new video. Download one only to measure it, keep it under `.work/reference/`, and never place it in `assets/`.

## Gates

Stop and get the user's answer at these points; work on anything that does not depend on it in the meantime.

1. After stage 1 when length, aspect or destination is unknown and cannot be read from the footage or the request.
2. After stage 3: the cut. Show the EDL snippets and the master. Nothing in stage 5 is timed until this is approved.
3. Before any paid generation the user did not ask for by name.
4. Before stage 7 publishes anything. Approval is per post.

In a no-questions run, gates 1 and 2 become decisions you record in the stage record with their reason; gates 3 and 4 still hold.

## Stage 6: master

- Target loudness: -14 LUFS integrated for YouTube and social, true peak at or below -1 dBFS. Run `analyze.py` on the render and compare; fix with the owner's mixing tools, not by re-encoding blind.
- Video and audio stream lengths match within 0.05 s (`notes` reports a mismatch).
- Scan the rendered frames for private strings before delivery (`--frames` at about 4 per second on a short, fewer on a long video).

## Inside SpecWithCode

These apply when the `studio-code` tools are present; elsewhere the stages run the same way without them.

- One thread per video, titled after the video. The stage record is what lets another thread, model or machine pick it up.
- Plan on the strongest model, execute on a cheaper one. Intake, the cut decision and the storyboard deserve the best model the project allows. Rendering, transcription, frame checks and re-renders do not: hand them to a cheaper model with `delegate_task`, or switch the thread with `studio_thread_configure` and `continueWith`.
- Heavy work goes to the machine that suits it. Launch render or transcription threads on another machine with `studio_thread_launch` and `machine`, and move footage there with `studio_file_transfer`. Keep the stage record and the cut files in the project folder so the result comes back the same way.
- Gates use `ask_user`. Publishing on signed-in sites goes through the `chrome_*` tools under `social-media-posting`.
- Show the result as one inline image or video plus the file paths, and save a longer write-up with `studio_report_save`.

## What this pipeline leaves out, and why

See `references/stage-map.md` for the tool-by-tool comparison with the public toolkit this ordering was checked against. In short: no timeline-editor connectors (the cut is a deterministic ffmpeg render from a reviewed cut list), no automatic silence or filler-word removal (it breaks whole takes), no cloud GPU rendering by default.

## Done when

- Every stage in `.work/pipeline.json` is `done`, `approved` or `skipped`, each with its artifact.
- The delivered file was measured after rendering and meets the stage 6 targets.
- The user approved the cut and, if anything was published, each post.
