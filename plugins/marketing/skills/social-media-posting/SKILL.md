---
name: social-media-posting
description: "Cross-platform social media content creation, posting, and engagement skill. Covers Instagram, LinkedIn, X/Twitter, Threads, YouTube, TikTok, Reddit, dev.to, Facebook, Discord, and Telegram. Handles image generation (Nano Banana Pro with 3 options per image at correct aspect ratios), carousel creation, video conversion, platform-specific posting flows, deduplication against recent posts, and daily engagement (replying to 10 threads per platform). Use this skill whenever the user wants to post content to social media, create social media visuals, schedule posts, engage with followers, grow their audience, reply to threads, or manage any social media activity. Also activate when the user mentions any social platform by name, says 'post this', 'share on social', 'engage', 'reply to threads', or references content distribution."
metadata:
  tags: social-media, instagram, linkedin, twitter, threads, youtube, tiktok, reddit, discord, telegram, posting, engagement, automation, image-generation
---

# Social Media Posting & Engagement

Post content across all major platforms with AI-generated visuals, mandatory human approval, and daily engagement to grow your audience.

---

## Core Rules (Non-Negotiable)

### 1. NEVER Post Without Approval

Every piece of content — posts, comments, replies — must be shown to you first. The workflow is always:

1. **Draft** the content (text + images)
2. **Present** it for review with a clear summary
3. **Wait** for explicit "go ahead" / "approved" / "post it"
4. **Post** only after approval
5. **Verify** the post is live and report the URL

This exists because social media is public, permanent, and tied to your reputation. A bad post can't be unseen. The cost of waiting 30 seconds for approval is nothing compared to the cost of posting something wrong.

### 2. Always Generate Images

Every post gets AI-generated visuals. Use the `nano-banana-pro` skill (Gemini 3 Pro Image) to create photo-realistic, editorial-quality images. For each image needed, generate **3 options** so the user can pick the best one. See the Image Generation section for exact dimensions per platform.

### 3. Check for Duplicates First

Before drafting any post, read the **last 10 posts** on each target platform. This prevents posting duplicate or near-duplicate content. Look for:
- Same topic covered in the last 48 hours
- Similar headlines or angles
- Overlapping key facts or data points

If you find overlap, flag it: "You posted about [topic] on [platform] [time ago]. Want to skip this platform, change the angle, or post anyway?"

### 4. Track Everything

After every post, collect the exact URL. Log all URLs (posts + engagement comments) to a daily log file. Never say "posted" without providing a clickable link.

### 5. Verify Before Reporting

Navigate to the profile/page after publishing and confirm the post actually appears. Be honest about failures — never report unverified posts as successful.

---

## Workflow Overview

```
0. DEDUP     -> Read last 10 posts per platform, flag overlaps
1. ANALYZE   -> Check post analytics history, recommend optimal posting time
2. CONTENT   -> Write platform-adapted copy
3. IMAGES    -> Generate 3 options per image with Nano Banana Pro (correct aspect ratio)
4. REVIEW    -> Present everything + timing recommendation to user, wait for approval
5. POST      -> Publish or schedule to each platform using best available tool
6. VERIFY    -> Confirm each post is live (or scheduled), collect URLs
7. ENGAGE    -> Find 10 threads per platform, draft replies, get approval
8. LOG       -> Write daily engagement log with all URLs
```

---

## Available Tools (Prefer Dedicated Tools)

Multiple tools may be available for posting. Always prefer dedicated CLI/API tools over browser automation — they're faster, more reliable, and don't break when UIs change.

### Tool Priority Order

| Platform | 1st Choice (Best) | 2nd Choice | 3rd Choice (Fallback) |
|----------|-------------------|------------|----------------------|
| X/Twitter | `xurl` CLI (if installed) | Puppeteer/browser automation | Peekaboo macOS UI automation |
| Discord | `discord` skill actions | Webhook API (`curl`) | Browser automation |
| Telegram | Telegram Bot API (`curl`) | N/A | N/A (web has no editor for channels) |
| Instagram | Puppeteer + Chrome profile | Peekaboo | N/A |
| LinkedIn | Puppeteer + Chrome profile | Peekaboo | N/A |
| Threads | Puppeteer + Chrome profile | Peekaboo | N/A |
| YouTube | Puppeteer + system clipboard | Peekaboo | N/A |
| Reddit | Puppeteer (old.reddit.com) | Peekaboo | N/A |
| TikTok | Puppeteer + ffmpeg video | Peekaboo | N/A |
| dev.to | Puppeteer + Chrome profile | Peekaboo | N/A |
| Facebook | Puppeteer + Chrome profile | Peekaboo | N/A |

### X/Twitter via `xurl` (Preferred)

If the `xurl` CLI is installed (`xurl auth status` to check), use it instead of browser automation:

```bash
# Post with image
xurl media upload image.png           # get MEDIA_ID from response
xurl post "Your tweet text" --media-id MEDIA_ID

# Thread: post main tweet, then reply
xurl post "Main tweet"                # get POST_ID
xurl reply POST_ID "Thread continuation"

# Search for engagement threads
xurl search "topic keywords" -n 10

# Reply to a thread
xurl reply POST_ID "Your thoughtful reply"

# Read recent posts (dedup check)
xurl timeline -n 10
```

### Discord via Skill Actions (Preferred)

If the `discord` skill is available, use its native actions:

```json
{
  "action": "sendMessage",
  "to": "channel:<CHANNEL_ID>",
  "content": "Your announcement text",
  "mediaUrl": "file:///path/to/image.png"
}
```

```json
{
  "action": "readMessages",
  "channelId": "<CHANNEL_ID>",
  "limit": 10
}
```

### Peekaboo (macOS UI Fallback)

When browser automation (Puppeteer) isn't available or breaks, use the `peekaboo` skill for macOS UI automation:

```bash
# See what's on screen, identify clickable elements
peekaboo see --app "Google Chrome" --annotate --path /tmp/see.png

# Click an identified element
peekaboo click --on B3 --app "Google Chrome"

# Type text
peekaboo type "Your post content" --app "Google Chrome"

# Paste from clipboard (for editors that reject keyboard input)
echo "Your text" | pbcopy
peekaboo hotkey --keys "cmd,v" --app "Google Chrome"
```

This is particularly useful when:
- Puppeteer can't connect to Chrome
- A platform's DOM changed and selectors broke
- File upload dialogs need native OS interaction
- You need to interact with system dialogs (CAPTCHA, etc.)

---

## Image Generation with Nano Banana Pro

Use the `nano-banana-pro` skill for all image generation. The script path is:
```
{nano-banana-pro baseDir}/scripts/generate_image.py
```

### Platform-Specific Dimensions

Each platform has an optimal aspect ratio. Include the target dimensions in your prompt so the model composes the image correctly, and use the right resolution setting.

| Platform | Aspect Ratio | Pixels | Use Case | Resolution Flag |
|----------|-------------|--------|----------|-----------------|
| Instagram Feed/Carousel | 1:1 (square) | 1080x1080 | Carousel slides | `--resolution 2K` |
| Instagram Story/Reel | 9:16 (vertical) | 1080x1920 | Stories, Reels | `--resolution 2K` |
| TikTok | 9:16 (vertical) | 1080x1920 | Video frames | `--resolution 2K` |
| X/Twitter | 16:9 (landscape) | 1200x675 | Tweet images | `--resolution 1K` |
| LinkedIn | 1.91:1 (landscape) | 1200x628 | Post images | `--resolution 1K` |
| Facebook | 1.91:1 (landscape) | 1200x628 | Post images | `--resolution 1K` |
| YouTube Community | 16:9 (landscape) | 1280x720 | Community posts | `--resolution 1K` |
| Threads | 1:1 (square) | 1080x1080 | Post images | `--resolution 1K` |
| Discord | 16:9 (landscape) | 1280x720 | Embeds | `--resolution 1K` |
| Telegram | 16:9 (landscape) | 1280x720 | Channel posts | `--resolution 1K` |
| dev.to | 16:9 (landscape) | 1000x420 | Cover image | `--resolution 1K` |

### Generating 3 Options Per Image

For every image, generate 3 distinct options with varied composition. Include the aspect ratio in the prompt:

```bash
# Option A — dramatic angle
uv run {baseDir}/scripts/generate_image.py \
  --prompt "square 1:1 composition, photorealistic tech editorial: [topic], cinematic lighting, dark gradient, clean typography overlay" \
  --filename "2026-03-04-topic-option-a.png" --resolution 2K

# Option B — data/infographic style
uv run {baseDir}/scripts/generate_image.py \
  --prompt "square 1:1 composition, [alternative visual: data visualization, charts, key stats]" \
  --filename "2026-03-04-topic-option-b.png" --resolution 2K

# Option C — human/product focus
uv run {baseDir}/scripts/generate_image.py \
  --prompt "square 1:1 composition, [third approach: device mockup, person using tech, product shot]" \
  --filename "2026-03-04-topic-option-c.png" --resolution 2K
```

Present all 3 to the user: "Here are 3 image options. Which do you prefer? (A/B/C, or I can regenerate)"

### Carousels (Instagram/TikTok)

Generate **5 slides**, each with **3 options** (15 images total). Present as a grid so the user can mix and match:

```
Slide 1 (Hook):    [A1] [B1] [C1]
Slide 2 (Point 1): [A2] [B2] [C2]
Slide 3 (Point 2): [A3] [B3] [C3]
Slide 4 (Point 3): [A4] [B4] [C4]
Slide 5 (CTA):     [A5] [B5] [C5]
```

**Logo handling:** When mentioning companies, scrape and download their official logos first. Pass logos as input images (`-i logo.png`) to Nano Banana Pro so they render correctly.

### Image Style Guidelines

- Photo-realistic, cinematic lighting, editorial quality
- Dark gradient backgrounds with clean typography overlays
- Professional tech-forward aesthetic
- Use timestamps in filenames: `yyyy-mm-dd-topic-name-option-X.png`

---

## Platform Posting

Each platform has quirks. Read `references/platform-posting.md` for the detailed technical guide (selectors, upload flows, encoding requirements, workarounds).

### Supported Platforms

| Platform | Content Type | Char Limit | Hashtags | Image Support |
|----------|-------------|------------|----------|---------------|
| X/Twitter | Text + image | 280 (free) / 25K (premium) | 1-3 | Yes |
| LinkedIn | Text + image | 3,000 | 3-5 | Yes |
| Instagram | Carousel / Reel | 2,200 caption | Up to 30 | Required |
| Threads | Text + image | 500 | 3-5 | Yes |
| TikTok | Video (from carousel) | 2,200 caption | 3-5 | Video only |
| YouTube | Community post | ~5,000 | N/A | Yes |
| Reddit | Text post | Unlimited | N/A | Optional |
| dev.to | Article (markdown) | Unlimited | Max 4 tags | Optional |
| Facebook | Text + image | 63,206 | 1-3 | Yes |
| Discord | Message | 2,000 | N/A | Yes (embed) |
| Telegram | Message | 4,096 | N/A | Yes |

### Content Adaptation

Don't copy-paste the same text everywhere. Adapt for each platform:

- **X/Twitter**: Punchy, concise, hook in first line. Thread for longer content.
- **LinkedIn**: Professional tone, insight-driven, mention implications for the industry.
- **Instagram**: Visual-first, caption supports the image. Use line breaks for readability.
- **Threads**: Casual, conversational, like talking to a friend.
- **TikTok**: Convert carousel slides to video with ffmpeg. Caption is secondary to visuals.
- **Reddit**: Match the subreddit's tone. Informative, no self-promo smell. Check flair requirements.
- **dev.to**: Full article format with markdown. Technical depth.
- **Discord**: Short, punchy, chat-style. No markdown tables (Discord renders them ugly). Use **bold** for emphasis, not headers.
- **Telegram**: Clean, formatted message. Use markdown formatting.

### TikTok Video from Carousel

TikTok web only accepts video. Convert carousel slides to a 9:16 vertical slideshow video:

```bash
ffmpeg -framerate 1/4 -i slide-%d.png \
  -c:v libx264 -r 30 -pix_fmt yuv420p \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2" \
  output.mp4
```

### Optimal Timing & Scheduled Posting

Posting at the right time can double engagement. Use a three-tier approach:

**Tier 1 — Analytics-driven (best).** Before posting, check the user's actual engagement data:
- Read the last 20-30 posts per platform
- Note which posts got the most likes/comments/shares
- Note what time and day those top posts went live
- Recommend posting at the time that historically performs best for THIS account

Present your analysis: "Your top 5 LinkedIn posts were all published between 7-8 AM EST on Tuesdays and Thursdays. I recommend scheduling for 7:30 AM EST tomorrow (Thursday)."

**Tier 2 — General best practices (fallback).** When analytics aren't available:

| Platform | Best Time (EST) | Weekend Shift |
|----------|----------------|---------------|
| X/Twitter | 9-11 AM | +1h |
| LinkedIn | 7-8 AM or 12 PM | Skip weekends |
| Instagram | 11 AM-1 PM, 7-9 PM | 10 AM-2 PM |
| TikTok | 10 AM, 7-9 PM | +1h |
| Threads | 7-9 AM or 12-3 PM | +2h |
| Facebook | 1-3 PM | 12-2 PM |
| Reddit | 6-9 AM | 8-11 AM |
| dev.to | 7-10 AM | Skip weekends |
| Discord | 10 AM-12 PM, 7-9 PM | Evenings better |
| Telegram | 9-11 AM, 7-9 PM | Same |

**Tier 3 — Breaking news.** Immediacy beats optimal timing. Post ASAP.

### Scheduled Posting Support

Several platforms support scheduling posts to go live at a specific future time. When the optimal time isn't "right now", use native scheduling.

| Platform | Native Scheduling | How |
|----------|------------------|-----|
| X/Twitter | Yes | Compose dialog has a calendar icon; or `xurl post "text" --scheduled-at "2026-03-05T14:00:00Z"` if supported |
| LinkedIn | Yes | Compose dialog > click clock icon > set date/time before clicking Post |
| Instagram | Yes (Creator Studio) | Via Creator Studio or Meta Business Suite > Schedule option |
| Facebook | Yes | Compose > click dropdown on Publish button > Schedule |
| YouTube | Yes | Studio > Upload > set "Schedule" instead of "Publish" |
| TikTok | Yes | TikTok Studio > upload > toggle "Schedule" > pick date/time |
| Reddit | No | Must post in real-time |
| Threads | No | Must post in real-time |
| dev.to | No | Can save as draft, publish manually later |
| Discord | No | Must post in real-time (or use a bot with cron) |
| Telegram | Yes | Bot API `sendMessage` with `schedule_date` parameter (Unix timestamp) |

**Workflow for scheduled posts:**
1. Analyze optimal time (Tier 1 or Tier 2 above)
2. Present recommendation: "Based on your analytics, best time is [X]. Schedule for [datetime]?"
3. After approval, set up scheduling on platforms that support it
4. For platforms without scheduling (Reddit, Threads, Discord, dev.to), note the target time and remind the user, or set a system reminder
5. Verify scheduled posts are queued (navigate to scheduled posts section on each platform)

### Telegram Posting

Broadcast channels have NO input box in web.telegram.org. Use the Bot API:

```bash
# Photo with caption
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendPhoto" \
  -F "chat_id=$CHANNEL_ID" \
  -F "photo=@image.png" \
  -F "caption=Your caption" \
  -F "parse_mode=Markdown"
```

---

## Deduplication: Reading Recent Posts

Before posting, check what was recently published to avoid repetition.

### How to Check Per Platform

| Platform | Method |
|----------|--------|
| X/Twitter | `xurl timeline -n 10` or navigate to profile |
| LinkedIn | Navigate to company/personal page, read last 10 posts |
| Instagram | Navigate to profile grid, check last 10 posts |
| Threads | Navigate to profile, read last 10 |
| Reddit | Navigate to user profile, check recent submissions |
| dev.to | Navigate to profile/dashboard, check recent articles |
| Discord | `discord readMessages` or scroll channel history |
| Telegram | `curl "https://api.telegram.org/bot$TOKEN/getUpdates"` or check channel |
| YouTube | Navigate to channel Posts tab |
| Facebook | Navigate to page/profile |
| TikTok | Navigate to profile |

If you find a recent post covering the same topic, present the overlap to the user before proceeding.

---

## Daily Engagement

Growing an audience requires showing up in other people's conversations. After publishing your own content, spend time engaging with the community.

Read `references/engagement-playbook.md` for the full strategy. The summary:

### The 10-Thread Rule

For each platform, find **10 active threads** related to your topics and leave a thoughtful reply. That's 10 per platform, not 10 total.

### Drafting Replies

Draft all 10 replies for a platform, then present them as a batch for approval:

```
Platform: X/Twitter
Thread 1: [link to thread]
  Reply: "Your drafted reply here"

Thread 2: [link to thread]
  Reply: "Your drafted reply here"

...approve all / edit / skip specific ones?
```

Wait for approval before posting any replies.

### Reply Quality Rules

- **1-3 sentences max**
- **Add genuine value** — a new perspective, relevant data, a follow-up question
- **Sound human** — match the platform's tone
- **Never use em dashes** — use commas, periods, or conjunctions instead
- **Don't force self-promotion** — maybe 1-2 out of 10 naturally reference your work

### Anti-Spam Safeguards

- **Reddit**: Max 3 comments per thread/hour. Max 5 total in 30 min. Space 5-10 min apart.
- **X/Twitter**: Max 5 replies in 10 minutes. Vary length and style.
- **LinkedIn**: Max 5-7 comments per hour. No identical phrasing.
- **General**: If CAPTCHA or rate limit appears, stop immediately and report it.

---

## Post-Publishing Checklist

- [ ] Verify the post is live
- [ ] Check that the full caption/text saved correctly
- [ ] Check tags/mentions persisted
- [ ] Copy the exact published URL
- [ ] Log the URL in the daily engagement file

---

## Daily Engagement Log

After ALL posting and engagement is complete, write a log file:

```
File: memory/YYYY-MM-DD-engagement-log.md

# Engagement Log — YYYY-MM-DD

## Posts Published
- **X/Twitter**: [URL]
- **LinkedIn**: [URL]
- **Instagram**: [URL]
...

## Engagement Replies
### X/Twitter (10 replies)
1. [thread URL] — "reply text snippet..."
...
```

---

## Reference Files

- `references/platform-posting.md` — Detailed platform-specific technical guides (selectors, upload flows, encoding, workarounds, Chrome profile setup, Puppeteer patterns)
- `references/engagement-playbook.md` — Deep dive on engagement strategy, finding threads, crafting replies, platform-specific tone guides
