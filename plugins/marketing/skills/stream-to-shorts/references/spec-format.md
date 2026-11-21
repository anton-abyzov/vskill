# File formats

The files the scripts read and write: the cut spec, the schedule inputs, the plan and the receipts. All paths in examples are placeholders.

## Cut spec

One JSON file per clip. Times are seconds. `in`, `out`, `drop`, `a_in` and `g_in` are source time; `cap_edit`, `labels`, `alt_words` and translated `caps` are output time (the time in the finished clip). Rectangles are `[x, y, w, h]` in source pixels.

```json
{
  "id": "a01-demo",
  "sources": {"main": "../src/VIDEO_ID.mp4"},
  "transcripts": {"main": "../src/VIDEO_ID.words.json"},
  "src": "main",
  "layout": "stack",
  "bar": "MY TEST SUITE WENT RED",
  "facecam": [1500, 650, 300, 180],
  "segments": [
    {"in": 4795.2, "out": 4799.0, "tight": true, "win": [200, 100, 900, 700]},
    {"in": 4803.1, "out": 4808.4, "tight": true, "win": [640, 380, 700, 540], "drop": [[4805.0, 4805.9]]}
  ],
  "fix": {"gpt": "GPT"},
  "cap_edit": [[2.1, 2.4, "40"]],
  "labels": [{"at": 3.0, "dur": 1.6, "text": "40 MIN LATER"}],
  "variants": {"b": {"bar": "IT FAILED ON THE FIRST RUN", "cap_edit": [[0.0, 0.4, "WATCH"]]}},
  "translations": {"es": {"bar": "...", "caps": [[0.0, 1.8, "..."]], "labels": {"0": "..."}}}
}
```

### Top-level keys

| Key | Required | Meaning |
|---|---|---|
| `id` | yes | Clip id; names the output files. Letters, digits, dot, dash and underscore only; the same holds for variant names and language codes |
| `sources` | yes | `{key: video path}`, relative to the spec file or absolute |
| `transcripts` | for `tight` | `{key: word JSON}` in source time: Whisper JSON with word timestamps, or a list of `{"w", "s", "e"}` |
| `src` | when there are several sources | Default source key |
| `layout` | no | `stack` (default): face, title bar, screen. `full`: one 9:16 picture, for moments with no facecam |
| `bar` | yes | Title bar text, not empty; `\n` makes two lines |
| `facecam` | for `stack` | The face area to show across the top, eyes to collar, not the whole overlay box |
| `facecam_frame` | no | The stream's overlay box, used by `compile_wide.py` to cover it |
| `segments` | yes | The cut, in order (below) |
| `shot` | no | Longest shot before an automatic split, default 1.45 |
| `punch` | no | Zoom on every second shot, default 1.08 |
| `fix` | no | `{heard: shown}`, applied to every caption word (exact match first, then lower case). An empty value removes the word |
| `cap_edit` | no | `[[t0, t1, text]]`: replaces each caption word that starts in that output-time range; empty text removes it |
| `alt_words` | no | `[[t0, t1]]` ranges whose captions use the second highlight colour (a second speaker) |
| `labels` | no | `[{"at", "dur", "text", "y"}]`; `y` is optional |
| `variants` | no | `{name: {"bar", "segments", "cap_edit"}}`: an alternate opening. Each key is optional; a variant with no `segments` uses the main ones, and `segments`, when given, must not be empty. With a variant only the variant's `cap_edit` applies; `fix` still applies |
| `translations` | no | `{lang: {"bar", "caps": [[t0, t1, text]], "labels": {index or original text: text}}}` |
| `language` | no | Language code passed to the transcribe command, default `en` |
| `font`, `colors` | no | Caption font name; `{"active": "#RRGGBB", "alt": "#RRGGBB"}` |
| `bar_y`, `cap_y`, `lab_y` | no | Override the layout's text positions |

### Segment keys

| Key | Meaning |
|---|---|
| `in`, `out` | Source window. Required, `out` after `in` |
| `src` | Source key for this segment |
| `tight` | Cut pauses over the gap and filler words inside the window, using the transcript of the sound the segment plays. With `a_in` that is the transcript of `a_src` (or of the segment's source), read at `a_in` |
| `gap` | Pause length that is cut, default 0.3 |
| `drop` | `[[a, b]]` source ranges to remove (a false start, a garbled line), in the time of the sound: with `a_in`, on the `a_in` clock. Works with `tight` only. A segment whose every part is dropped is left out |
| `win`, `crop` | Screen window to show. The cutter cover-crops it to the panel's aspect, so the picture always fills the panel |
| `focus` | `[x, y]` centre of the window when it should not be the centre of `win` |
| `z`, `punch` | Fixed zoom for this segment; zoom of its punched shots |
| `max_zoom` | Zoom cap for this segment, default 2.0 |
| `still` | Keep the segment as one shot (no automatic split) |
| `face`, `face_dy` | A different face box for this segment; vertical shift of the face window |
| `layout` | `stack` or `full` for this segment only |
| `speed` | Playback speed of this segment, above 0. Not a fix for length |
| `vol`, `gate` | Volume factor; noise-gate threshold for this segment's sound |
| `a_src`, `a_in` | Take the sound from another time (`a_in`), and optionally another source (`a_src`), while the picture stays. `a_src` does nothing without `a_in`, and both are ignored on a segment with `g_in` |
| `g_in` | Take the screen picture from another time while the face and sound stay |

### What the cutter writes

`plan --out` writes `plan[-variant].json` (the shot list with its crop windows). `render` and `finish` write, in `--out`: `<id>[-variant][-lang].mp4` (the master), `shots[-variant].json`, `words[-variant].json` (caption words in output time, before fixes), `burned[-variant].json` (the words as burned, after `fix` and `cap_edit`), `cap[-variant][-lang].ass`, `metrics[-variant][-lang].json` and `base[-variant].nut` (the cut before text).

`metrics.json`: `file`, `duration_s`, `shots`, `longest_shot`, `first_change_s` (the end of the first shot), `cuts_per_min`, `first_word_s`, `words`, `wpm`, `speech_gaps_over_0.6`, `loudness` (`I`, `LRA`, `TP`), `size_mb`, and `words_source` (`words-file`, `transcribed` or `source-transcript`). `source-transcript` means the stream transcript was mapped through the cut and carries its errors.

`--words` takes words in output time. The spec's `transcripts` are source time. Do not mix them.

## Schedule files

### clips.json

An ordered list, most important first.

| Key | Meaning |
|---|---|
| `id` | Clip id |
| `tags` | Used by an account's `require_tags` and `exclude_tags` |
| `lead` | Wanted local time of the first post, `YYYY-MM-DD HH:MM` |
| `variant_of` | The base clip, for an alternate opening. It is held |
| `release` | `true` after the base clip's 72 hour read allows it |
| `content` | Copied to each post: `{"text", "media", "title", "settings"}`, or one such object per language code under `"default"`, `"es"`, ... |
| `meta` | Copied to each post and into the retention log: `hook`, `title`, `length_s`, `first_word_s`, `silence_ratio`, `series` |

### accounts.json

A list of accounts, or `{"accounts": [...], "caps": [...]}`. Build it from the routing skill per batch. It holds scheduler account ids: keep it out of every repository.

| Key | Meaning |
|---|---|
| `key` | Your short name for the account |
| `platform`, `backend` | `backend` is `postiz` or `blotato` |
| `ref` | The scheduler's account id, copied as is |
| `lang` | Picks the clip's `content` for that language |
| `wave`, `offset_minutes` | `lead` or `follow`; minutes after the wave's start. A lead wave starts at the clip's lead time, a follow wave 24 hours later |
| `min_gap_hours`, `max_per_day` | Spacing (default 6) and a daily cap |
| `require_tags`, `exclude_tags` | Tag routing |
| `settings` | Platform settings copied to each post |

A cap: `{"name", "accounts": [keys], "max", "window_hours"}`, a rolling window; `window_hours` is a number above 0 and `max` is a whole number, 0 or more. In the plan each cap also carries `refs`, the scheduler ids of its accounts, which `posts.py` uses to check the cap against the live queue.

### busy.json

`[{"account": "<key or ref>", "when": "<ISO with offset, or local YYYY-MM-DD HH:MM>", "clip": "<id, optional>"}]`. Everything already queued or created on those accounts.

### plan.json

Written by `plan_schedule.py`: `tz`, `posts`, `held`, `skipped`, `busy`, `caps`, `cap_report`. A post row has `clip`, `account`, `platform`, `backend`, `ref`, `lang`, `wave`, `when_local`, `when_utc`, `wanted_local`, `moved_minutes` (how far the slot moved from the wanted time), `variant_of` for a released variant, the account's `settings`, plus the clip's `content` and `meta`. `held` rows carry `clip`, `base`, `reason`, `not_before_local` and `not_before_utc`: 72 hours after the base clip's first post, queued (a `busy` row that names the clip) or planned; for a base with neither, after its lead or the plan's start. A released variant is never placed before that time, whatever its own `lead`. `skipped` rows carry the reason.

### receipts.jsonl

One JSON line per action, written by `posts.py` after redaction: `create` (`backend`, `host`, `post_id`, `ref`, `clip`, `account`, `platform`, `when_utc`, and `group` or `media`), `create_failed`, `media_failed`, `create_unconfirmed` (a success status with no post id), `update_in_place` and `delete` (`post_id`, `why`; a delete also has `host` and `gone`). Every line has `action` and `at`. The `create` lines with a post id are the list of posts this batch owns, on that `host`.

### changes.json and ids.json

`changes.json`: `[{"post_id", "why", "media": {"id", "path"}, "content", "title", "title_max", "replace": [old, new], "date"}]`; everything but `post_id` is optional. A `date` with no zone is read as UTC and is always sent as UTC. `ids.json`: `[{"post_id", "why"}]`. Both are checked against the receipts before anything is sent.
