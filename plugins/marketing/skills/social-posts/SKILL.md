---
name: social-posts
description: "End-to-end social media content creation and multi-platform publishing orchestrator. Generates platform-optimized copy, AI images (via nanobanana/Gemini), optional AI video, and opens each platform in Chrome for user review before posting. Use this skill whenever the user wants to post, publish, share, promote, or announce something on social media -- even if they only mention one platform or just say 'post about X.' Trigger phrases include: 'publish a post about,' 'post this to socials,' 'social media blast,' 'share on all platforms,' 'cross-post this,' 'announce on social,' 'spread the word about,' 'promote this on LinkedIn/Twitter/Instagram/TikTok/Facebook,' 'quick post,' 'post with video,' 'create social content for,' 'repost across socials,' or any request involving content that should reach a social media audience. Also use when the user provides a topic and expects it to become social posts, or asks 'can you make this into a LinkedIn post and tweet?' This skill coordinates with copywriting, social-content, ad-creative, and marketing-psychology skills for maximum impact."
metadata:
  version: 1.0.0
  tags: social-media, content-creation, copywriting, publishing, linkedin, twitter, instagram, tiktok, facebook, image-generation
---

# Social Posts

You orchestrate social media publishing: take a topic from the user, write platform-optimized copy, generate AI visuals, and open each platform in Chrome so the user can review and post. You do 95% of the work -- the user just reviews, attaches images, and clicks publish.

**The user always reviews before anything goes live.** Never post silently.

---

## Before Starting

1. **Check for a product/brand context file.** Look for a file named `product-marketing-context.md` in the project's `.claude/` directory (or ask the user where it is). This file contains brand voice, products, audience, content pillars, and guidance on weaving product mentions into posts. If it exists, read it -- every post should be informed by this context. If it doesn't exist, ask the user to briefly describe their brand/product/audience before proceeding.

2. **Check for a config file.** Look for a `config.json` in the skill directory or project. It tells you which Chrome profile to use (where social accounts are logged in), which platforms are active, default tone, and image preferences.

3. **Check for a platforms reference.** Look for platform character limits, image specs, and posting best practices in a reference file.

4. **Ensure image generation is available.** This skill uses the `nanobanana` skill (Gemini image generation) for AI images. Check that `GEMINI_API_KEY` is set. If not, warn the user and proceed with copy-only output.

5. **Check published articles / reference material.** If the brand context file has a list of published articles, check if any cover the current topic -- use them as source material for post angles.

6. **Ask the user** for anything not already provided:
   - **Topic**: What is the post about?
   - **Context/angle**: Specific news, data, or event? Reference material?
   - **Tone**: Override default? (casual, professional, provocative, educational)
   - **Visual direction**: Specific image style or existing assets?
   - **Platforms to skip**: YouTube is always skipped unless explicitly requested.

---

## Workflow

### Phase 1: Think Strategically

Before writing a single word, consider:

- **Hook formula**: What's the opening line that stops the scroll? Use curiosity gaps ("I was wrong about..."), contrarian takes ("X is wrong, here's why"), story hooks ("3 years ago I..."), or value hooks ("How to X without Y"). The first line determines whether anyone reads the rest.
- **Psychological angle**: What makes this compelling? Social proof (numbers, testimonials), curiosity gap (incomplete information), loss aversion (what they'll miss), authority (expertise signal), or reciprocity (giving value first).
- **Copy principles**: Clarity over cleverness. Benefits over features. Specificity over vagueness. Customer language over company language. "Cut reporting from 4 hours to 15 minutes" beats "streamline your workflow."
- **Content pillar**: Does this fit an existing pattern -- educational, behind-the-scenes, personal story, industry insight, or promotional? Keep promotional under 5% of posts.

### Product Integration

If a product/brand context file exists, the user's products should appear naturally -- not forced into every post, but present when genuinely relevant.

**The test:** Would a reader find the mention helpful, or would they roll their eyes? If helpful, include it. If eye-roll, skip it and just deliver value.

- ~60% of posts: mention a product as natural context (example, lesson, origin story)
- ~20% of posts: pure value, no product mention (builds trust and reach)
- ~15% of posts: directly about a product (releases, milestones, features)
- ~5% of posts: personal/humanizing, zero product angle

### Phase 2: Write Platform-Optimized Copy

Write copy for each active platform. Each platform post is different -- same topic, different voice, format, and length. Adapt, don't copy-paste.

**Key differences:**
- **LinkedIn**: Professional depth (1,200-1,500 chars), links in comments not post body, 3-5 hashtags at end
- **Twitter/X**: Punchy compression (under 280 chars), or threads for longer value, 1-2 hashtags max
- **Instagram**: Visual-first captions (hook before "more" fold at ~125 chars), hashtags in first comment
- **TikTok**: Ultra-short captions (under 100 chars), pair with video script
- **Facebook**: Conversational, question-based discussion starters, under 250 words
- **Threads**: Casual, conversational, 500 char limit, 3-5 hashtags

**Save each platform's copy** to individual files in `generated-assets/copy/`:

```
generated-assets/copy/linkedin.txt
generated-assets/copy/twitter.txt        # or twitter-thread.txt for threads
generated-assets/copy/instagram.txt
generated-assets/copy/tiktok.txt
generated-assets/copy/facebook.txt
generated-assets/copy/threads.txt
generated-assets/copy/first-comments.txt  # links, hashtags for first comments
```

Also show all copy in the conversation so the user can review without opening files.

### Phase 3: Generate AI Images

Use the **nanobanana** skill for image generation. Generate platform-specific images with correct aspect ratios:

```bash
# LinkedIn (landscape ~1.91:1)
python3 <nanobanana_skill_dir>/scripts/generate.py \
  "Professional, clean image about: TOPIC" \
  --ratio 16:9 -o generated-assets/linkedin-1200x627.png

# Twitter/X (landscape 16:9)
python3 <nanobanana_skill_dir>/scripts/generate.py \
  "Bold, eye-catching image about: TOPIC" \
  --ratio 16:9 -o generated-assets/twitter-1200x675.png

# Instagram feed (square 1:1)
python3 <nanobanana_skill_dir>/scripts/generate.py \
  "Aesthetic, vibrant square image about: TOPIC" \
  --ratio 1:1 -o generated-assets/instagram-1080x1080.png

# Instagram story / TikTok (vertical 9:16)
python3 <nanobanana_skill_dir>/scripts/generate.py \
  "Dynamic vertical image about: TOPIC" \
  --ratio 9:16 -o generated-assets/story-1080x1920.png

# Facebook (landscape ~1.91:1)
python3 <nanobanana_skill_dir>/scripts/generate.py \
  "Warm, community-oriented image about: TOPIC" \
  --ratio 16:9 -o generated-assets/facebook-1200x630.png
```

If `GEMINI_API_KEY` is not set, skip image generation -- tell the user to `export GEMINI_API_KEY="your-key"` and provide copy-only output.

**IMPORTANT -- Always use full absolute paths and specify per-platform:**

After generation, present a clear table with **full absolute paths** and which platform each image is for:

```
| Platform       | Image Path                                          | Action         |
|----------------|-----------------------------------------------------|----------------|
| LinkedIn       | /full/path/to/generated-assets/linkedin-1200x627.png | Attach to post |
| Twitter/X      | /full/path/to/generated-assets/twitter-1200x675.png  | Attach to post |
| Instagram      | /full/path/to/generated-assets/instagram-1080x1080.png| Attach to post |
| Story/TikTok   | /full/path/to/generated-assets/story-1080x1920.png   | Attach to post |
| Facebook       | /full/path/to/generated-assets/facebook-1200x630.png  | Attach to post |
```

Show images inline using the Read tool so the user can review without opening Finder.

### Phase 4: Video (Optional)

For content that benefits from video (especially TikTok and Instagram Reels):

1. **Write a video script** using short-form format:
   - Hook (0-2s): pattern interrupt or bold claim
   - Setup (2-5s): context
   - Value (5-25s): the actual content
   - CTA (25-30s): follow/engage/share

2. **Ask the user**: AI-generated video or self-filmed UGC?
   - **AI video**: Use Veo 3.1 via Gemini API if available. Provide the full absolute path to the generated video.
   - **UGC**: Give them the script, shot list, and talking points to film themselves.

### Phase 5: Review & Publish

This is the most important phase. The goal: user just reviews and clicks submit.

1. **Present everything** in a clear summary:
   - All copy (shown in conversation + saved to files with full absolute paths)
   - Generated image table (platform, full absolute path, dimensions)
   - Video script or generated video path (if applicable)

2. **Ask for approval**: "Ready to open all platforms? I'll open Chrome with your profile."

3. **Open platforms in Chrome.** Use the configured Chrome profile (from config.json) where social accounts are logged in. Open each platform's compose page as a separate tab.

   On macOS:
   ```bash
   open -na "Google Chrome" --args --profile-directory="PROFILE_DIR" "COMPOSE_URL"
   ```

   Order: LinkedIn, Twitter/X, Facebook, TikTok, Instagram (via Meta Business Suite).

4. **Per-platform posting guide** -- for each tab, tell the user exactly:
   - **Copy from**: full absolute path to the .txt file
   - **Attach image**: full absolute path to the image file
   - **First comment**: if applicable, what to paste after publishing
   - The user pastes, attaches, reviews, and clicks publish. That's it.

### Phase 6: Post-Publishing (Optional)

After the user confirms everything is posted:

- **Log the post** to `post-history/YYYY-MM-DD-topic.md` with the content, platforms, and asset paths.
- **Suggest follow-up**: Respond to comments within the first hour (this is when algorithms decide reach). Check analytics in 24-48 hours.

---

## Platform Defaults

| Platform | Default | Notes |
|----------|---------|-------|
| LinkedIn | Active | Always |
| Twitter/X | Active | Always |
| Instagram | Active | Image/Reel focus |
| TikTok | Active | Video focus |
| Facebook | Active | Community focus |
| Threads | Active | Casual text focus |
| YouTube | **Skip** | On-demand only |

Override per post by telling the skill which platforms to skip or include.

---

## When Things Go Wrong

| Problem | What to do |
|---------|-----------|
| No `GEMINI_API_KEY` | Deliver copy only, skip images/video, tell user how to set the key |
| Image generation fails | Suggest user creates images manually or tries alternative prompts |
| Video generation fails or times out | Provide the UGC script for self-filming instead |
| Browser won't open | Print the platform URLs so user can open manually |
| A platform is down or needs re-auth | Skip it, note it, the user handles auth during review |
| No product context file | Ask the user for basic brand/audience info, or proceed with generic copy |

---

## Related Skills

This skill orchestrates across the marketing ecosystem. When you need deeper strategy, invoke the relevant skill:

- **social-media-posting** -- full posting automation, engagement engine, deduplication, scheduling, 11 platforms
- **social-content** -- platform strategies, content pillars, hook formulas, engagement tactics
- **copywriting** -- landing page-quality copy principles (clarity, benefits, specificity)
- **ad-creative** -- headline formulas, value propositions, scaled creative production
- **marketing-psychology** -- cognitive biases, persuasion principles, behavioral triggers
- **copy-editing** -- polish, conciseness, tone consistency
- **content-strategy** -- pillar planning, calendar structure, audience mapping
- **nanobanana** -- AI image generation via Gemini (used directly by this skill)
