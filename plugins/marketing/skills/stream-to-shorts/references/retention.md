# After publishing: verify, log, decide

Use this file once posts start to fire: confirm each post is live and correct, keep the retention log, and let the decision rule say what happens to each clip next.

Basis tags: **[M]** measured on reference shorts (a November 2026 sample of 15 outlier shorts: 7 talking AI-coding clips and 8 gaming clips), **[V]** vendor or practitioner claim, **[C]** our choice.

## 1. Verify every post after its fire time

1. After each post's fire time, confirm four things: it is live, on the right account, with the right file, and with the right caption and title [C].
2. Read the post back through the scheduler helper: `python3 <SKILL_DIR>/scripts/posts.py --backend <postiz|blotato> show <post-id>`. It prints an allowlist of fields only. Never read posts with a raw API call, which can print credential fields.
3. Where the platform allows it, open the public URL in a logged-out browser (headless) and check the first frame and the title against the master [C]. TikTok, Instagram and Threads hide some numbers from logged-out viewers, so this check is for the post itself, not its metrics.
4. Record the live URL and the words "verified live" in the post's row of the retention log, with the time you checked.
5. A post that failed, or went out with the wrong media, caption or title, is fixed or removed by its owner (whoever holds that account's sign-in). Never re-post it silently. Log what happened in the row.
6. Never the same file twice on one account. A replacement is a new cut with a new first 2 s and a new title [C], because platforms demote duplicates (see `references/platform-specs.md`, section 0).

## 2. The retention log

Create the log from the schedule plan, one row per post:

```bash
python3 <SKILL_DIR>/scripts/retention_log.py init plan.json retention-log.csv
```

The header that `init` writes is the authority for column names. The log holds, per post:

| Group | Columns |
|---|---|
| Identity | clip id, platform, account, post time with its zone, post id, live URL, verified live (yes or no), read at 24 h, read at 72 h, status (planned, live, failed, removed) |
| What was tested | hook type, title wording, series. A variant is its own clip id; the plan links it to its base |
| Cut facts | length, first-word time, silence ratio |
| Reads | views, viewed vs swiped (YouTube), average percentage viewed, second of the steepest drop, 3 s skip rate (Instagram), completion (TikTok), likes, comments, shares or sends |
| Risk | copyright claim (yes or no, with the window time in the source) |

Rules:

1. **Who reads.** Whoever holds the account sign-in, usually the account owner or a posting agent acting with their sign-in. The editor never signs in to an account [C].
2. **When.** 24 h and 72 h after each post [C]. The 24 h read drives the winner and loser calls. The 72 h read decides held variants.
3. **Series.** Log clips from different kinds of footage (for example gaming and coding) as separate series, so one series' flop is not blamed on the other [C].
4. **Hand-filled until OAuth exists.** An automated pull of analytics needs the account owner's OAuth grant for each platform. Until that exists the log is filled by hand from each platform's analytics screen. Never ask for or store a password to do it.

## 3. The decision rule

```bash
python3 <SKILL_DIR>/scripts/retention_log.py decide retention-log.csv --baseline-views N --plan plan.json
```

`--plan` links each held variant to its base; without it `decide` makes no release or A/B call. `init` can be run again after a re-plan: rows already in the log are kept as they are.

The lines below are the rule; `decide` implements it.

1. **Baseline.** N is the median views of the account's last 25 short videos [C]. Take it per account.
2. **Winner (24 h read).** Views at or above 3x the baseline, and on YouTube viewed vs swiped at 70% or more [C]. A YouTube row with no viewed-vs-swiped number is not called a winner. The 70% and 60% viewed-vs-swiped lines here and in the loser line are borrowed from the [V] claims in section 4.
3. **Breakout.** Views at or above 10x the baseline, with the same viewed-vs-swiped condition [C].
4. **Loser (24 h read).** Viewed vs swiped under 60% on YouTube, whatever the views, or views under 0.75x the baseline [C]. The 0.75 leaves a clip that lands just under a median out of the loser pile: half of all clips are under the median by definition.
5. Anything between the loser and winner lines is `keep`: it finishes its short-video-feed posts and gets no post on the platforms gated by the wave rule (`references/platform-specs.md`, section 5).

### Per-clip diagnosis

Read the retention curve of every clip, not only the losers.

| Where the curve drops hardest | What it means | What to change |
|---|---|---|
| About 5 s | The open failed | Only the first 2 s. Keep the rest of the cut [V] |
| About 30 s, or after 60% of the runtime | The payoff came too late | Move the payoff earlier, or cut to it and stop [V] |

### Doubling down on a winner

Within 24 h of a clip crossing the winner line:

1. Pull its remaining waves forward to the next free slots, within the spacing rule in `references/scheduling.md`.
2. Make the translated versions (for example `es`), each read by a native speaker before it posts.
3. Render the 4:5 recrop (preset P3) for the timeline platforms: X, the LinkedIn main feed, the Facebook feed.
4. Cut a second clip from the same moment, or the next 30 s, with a different hook and a different title. It is a new clip, not a repost.
5. Never post the same file to the same account.
6. Answer comments in the first 2 hours after each post [V].
7. Reuse the winning hook type on the next clips, with fresh wording and overlays.

### A loser

1. Give it a new first 2 s and a new title.
2. Post it only to platforms where it has not run yet.

### Hook variants

1. A hook variant (an alternate opening of the same clip) never gets its own slot at schedule time. It is held [C].
2. The base clip's 72 h read releases or drops the variant. `decide` releases it only when the base is a loser or `keep`; a winner keeps its first version. A released variant goes only to accounts where the base did not run [C]. A variant with the same title bar as the base reads as a repost.
3. **A/B sample rule.** Call a winner between two variants only when each has 300 or more plays and the 3 s skip rates differ by 8 points or more [C]. Basis: at a skip rate near 65%, the standard error of the difference at 100 plays per variant is sqrt(2 x 0.65 x 0.35 / 100), about 6.7 points, so the 95% interval is about plus or minus 13 points. At 300 plays it is about plus or minus 7.6 points.
4. Below that, log "no difference" and keep the base. Pool results by hook type across clips. Never decide a hook type from one or two tests.
5. A win on one platform is a prior for another, not a result. Read each platform's own numbers.

### Judging the format

1. **Format review after 10 posts** on the main platform: if the median viewed vs swiped is under 60%, stop cutting new clips and rework the opens first [C].
2. Judge the format after 20 to 30 clips, not after one [V].
3. Set expectations from the account's own history (its baseline and its 75th percentile), not from famous reference clips. Viral reposts of famous streamers get their reach from the streamer's name, not from the format [C]. Most clips on a small account land near the baseline; a good first week is a complete log and one winner.

## 4. Platform thresholds

These are vendor and practitioner claims, not official numbers [V]. Use them to read a clip, not as the decision rule.

| Platform | Metric | Claim |
|---|---|---|
| YouTube Shorts | Viewed vs swiped away (Studio, Reach) | 70% or more is good, 80% is strong, under 60% means the open is wrong [V] |
| YouTube Shorts | Average percentage viewed | 80% or more on a 20 to 30 s clip [V] |
| Instagram Reels | 3 s skip rate | Under 60% [V] |
| TikTok | Completion | 50 to 70% on clips under 30 s [V] |

## 5. If audio is claimed

1. **Before posting.** Mute or replace any licensed music span (game radio, game score, cutscene music, music playing in the room), or pick another window. Do not rely on an in-game "mute licensed music" setting unless the publisher documents it [C].
2. **YouTube, before publishing.** Upload as private first and read the copyright result before publishing. Check in Studio which claim tools it offers (trim, mute song, replace song); this research did not verify them.
3. **YouTube, after a claim.** A claimed Short over 60 s is blocked worldwide (see `references/platform-specs.md`, section 0). Under 60 s, use the Studio claim tools to mute or trim the span if they are offered.
4. **TikTok or Instagram, muted audio.** A voice clip with muted audio is dead. Removal needs the account owner's yes. Re-render with the span muted, a new first 2 s and a new title, and post it as a new cut, never the same file.
5. **Log it.** Record the claim with its window time in the retention log, and mark that stretch of the source as unsafe in the census so no later clip uses it.
