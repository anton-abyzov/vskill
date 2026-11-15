# Stage map: a public 13-step workflow against this pipeline

## Source and credit

The ordering in this skill was checked against a workflow Riley Brown showed publicly in "The Biggest Week in Claude History..." (YouTube, published November 14, 2026, https://www.youtube.com/watch?v=j5BDkyEcML4). Early in the video he shows a whiteboard and a sheet that list the tools he uses, in 13 steps from his computer to the finished video. He says an agent built the outline from about 70 of his own video-editing threads.

What is taken from that source: the idea of writing the whole edit down as one ordered list of stages with an owner per stage, and the 13 step names. His sheet, whiteboard, skills, prompts and wording are his and are not reproduced here; go to his video for his tool list. The tool names below are a few examples as they appeared on screen and were not checked beyond that. The video shows the list for a few minutes and does not explain how any step works, so every instruction in this skill comes from our own practice, and `scripts/analyze.py` was written independently with ffmpeg.

## Step by step

| His step | Kind of tool he lists (examples as shown on screen) | Here | Decision |
|---|---|---|---|
| 1 Computer | a laptop | any machine with ffmpeg; heavy stages can run on a second machine | same idea, stated as machine routing |
| 2 Film | camera and recording apps | OBS recordings | recording is outside the pipeline |
| 3 Prompt | a coding agent, notes, a skill builder | stage 1 intake | adopt the stage; notes stay in the project folder |
| 4 Analyze | ffmpeg, a local transcriber, a video-understanding model, face tracking, scene detection, a reference-video skill | stage 2, `scripts/analyze.py` | adopt, as a fixed first step with one output file |
| 5 Cut | connectors to timeline and text-based editors | stage 3, `hyperframes-best-practices` | keep ours; see below |
| 6 Scrape assets | web scrapers, a video downloader | stage 4, `media-use` resolve | keep ours; references are measured, not reused |
| 7 Generate assets | image, video and voice models | stage 4, `kie-gemini-omni`, `media-use` voice | keep ours |
| 8 HyperFrames | the HyperFrames skills | stage 5 | same |
| 9 Motion graphics | motion-graphics and related skills | stage 5 | same |
| 10 Explainer styles | style skills | stage 5, the `hyperframes` explainer route | keep ours; style is chosen per video |
| 11 3D | Blender on rented GPUs | the `hyperframes` 3D route; local Blender only when asked | not adopted by default |
| 12 Assemble and master | ffmpeg and an encoder | stage 6 | adopt explicit mastering targets |
| 13 Save and deliver | upload tools and cloud storage | stage 7, `social-media-posting` | keep ours |

## Where the two differ on purpose

- **Cutting.** Recorded takes here follow one rule: the last attempt of each passage is kept whole, pauses included, and only the head and tail of a take are trimmed. We cut from a reviewed cut list rendered by ffmpeg, which applies that rule exactly and can be re-run. Editor connectors were not evaluated for it.
- **Analysis.** One script that writes one file is easier to resume from and to hand to another model than several tools. Face tracking and a video-understanding model stay optional, because most of these videos are a full-screen speaker with cards over it and have no moving crop to track.
- **Scraping.** Here a downloaded video is a reference to measure. Only licensed, owned or generated media enters `assets/`.
- **3D on rented GPUs.** Not needed for the current videos, and it adds a paid service. Revisit when a video needs a rendered 3D scene the HyperFrames 3D route cannot produce.

## What that list had that was missing here

1. A written order with one owner per stage. The skills existed; the route between them lived in the operator's head.
2. Measuring before cutting as a fixed step, with pacing numbers.
3. Measuring a reference video instead of describing it.
4. Stated mastering targets, and re-measuring the render.

Those four are what this skill adds.
