# Platform specs and per-platform treatment for stream shorts

Use this file at the export and scheduling stages: what each platform accepts, what it ranks on, and how one clip is adapted for each.

Research dates: November 20 and 21, 2026. Every number below was read from the linked page on those dates.

Source tiers:

- **[OFF]** official help or policy page for organic posts
- **[ADS]** official ads spec, used as a proxy where the platform publishes nothing for organic posts
- **[API]** official developer docs. These limits bind any scheduler that publishes through the APIs
- **[3P]** third-party guide. Treat as a hint and check it in the app before relying on it
- **[PRAC]** practitioner advice with no platform source
- **[C]** our choice, with the reason next to it

"Not verified" means no source was read, so the number is left out rather than filled in from memory.

Platforms change these limits often. If the research date above is more than about three months old, re-read every number from its link before a batch and update this file.

## 0. What matters most for clips cut from a stream

1. **Never post a clip downloaded from another platform.** Instagram makes "low-resolution or watermarked reels" and "reels that have already been posted on Instagram" less visible ([about.instagram.com ranking explained](https://about.instagram.com/blog/announcements/instagram-ranking-explained), May 31, 2023) [OFF]. Facebook says "Avoid using visible third party watermarks and content that is visibly recycled from other apps" ([creators.facebook.com](https://creators.facebook.com/blog/combating-unoriginal-content), July 14, 2025) [OFF]. Render every platform from your own master. Never re-upload a TikTok download, and never post the same file twice on one account.
2. **On YouTube, Shorts over 1 minute with any copyright claim are blocked globally**, and they "can't be played, recommended, or monetized" ([support.google.com/youtube/answer/15424877](https://support.google.com/youtube/answer/15424877?hl=en), retrieved November 20, 2026) [OFF]. Game radio, game score and any music playing on stream will draw Content ID claims. Keep clips with game audio at or under 60 s, or mute or replace the music.
3. **Reused and inauthentic content (YouTube, updated July 15, 2025).** Reused content is allowed when it is "Content that primarily features the uploading creator" ([answer/1311392](https://support.google.com/youtube/answer/1311392?hl=en)) [OFF], so clips of a creator's own stream are fine. The renamed "inauthentic content" rule targets content that "looks like it's made with a template, or that may feel repetitive to viewers after watching several videos in a row." It is a monetization policy, so a batch of 20 clips that share a template, a hook formula and a title pattern risks being judged repetitive. Give every clip a distinct moment, hook and title, and vary the overlays [C].
4. **AI labels mostly do not apply.** YouTube needs no disclosure for "Video game gameplay footage", for captions, audio cleanup, or for AI-written titles and thumbnails. Disclosure is required only for realistic synthetic people, events or places ([answer/14328491](https://support.google.com/youtube/answer/14328491?hl=en)) [OFF]. TikTok requires a label on "AI-generated or significantly edited content that shows realistic-looking scenes or people" ([Integrity and Authenticity](https://www.tiktok.com/community-guidelines/en/integrity-authenticity), effective September 24, 2026) [OFF]. Meta "may require" an AI label for "photorealistic video or realistic-sounding audio that was digitally created" ([meta.com help](https://www.meta.com/en-gb/help/artificial-intelligence/1783222608822690/), retrieved November 20, 2026) [OFF]. An AI voice heard in the creator's own stream is not realistic synthetic footage, so no label is needed. Label any AI-generated realistic B-roll and any cloned voice of someone other than the creator.
5. **Shorts links:** Shorts descriptions and comments are not clickable. The only clickable route is the **Related video** link, shown below the channel handle ([answer/14075157](https://support.google.com/youtube/answer/14075157)) [OFF]. Point every Short at the full stream VOD or a long-form video.
6. **What the platforms say they rank on, in short:** completion and watch time (TikTok, Instagram, X, LinkedIn dwell), sends and shares (Instagram for non-followers, X "share via DM"), and originality (Instagram, Facebook, TikTok, YouTube). Follower count is not a direct factor on TikTok. Slow pacing loses on every one of these.

## 1. Text-safe zones on a 1080x1920 frame

These zones limit TEXT only: burned captions, the title bar, labels and any other readable element. The picture fills the whole frame edge to edge, including the zones below. A render with an empty band at the bottom is a reject (`scripts/fill_check.py`). Where the face, the screen and the title bar go is in `references/layout.md`.

| Source | Top | Bottom | Left | Right | Tier |
|---|---|---|---|---|---|
| YouTube vertical (Shorts and ads), Google universal safe zones PDF | 288 | 672 | 48 | 192 | [ADS], pixel values read from the PDF image ([services.google.com PDF](https://services.google.com/fh/files/misc/universalsafezones-youtube.pdf), retrieved November 21, 2026) |
| Instagram Reels / Facebook Reels: 14% top, 35% bottom, 6% sides ([IG Reels ads guide](https://www.facebook.com/business/ads-guide/update/video/instagram-reels), [FB Reels ads guide](https://www.facebook.com/business/ads-guide/update/video/facebook-facebook-reels)) | 269 | 672 | 65 | 65 | [ADS] |
| TikTok organic (no official pixel spec; ads page offers only downloadable overlays, [ads.tiktok.com](https://ads.tiktok.com/help/article/video-ads-specifications)) | 108 to 240 | 320 to 422 (660 for ads) | 60 | 120 to 173 | [3P] ([manypixels](https://www.manypixels.co/blog/social-media-design/tiktok-ad-specs), [adaptlypost](https://adaptlypost.com/blog/social-media-safe-zones-2026-complete-guide)) |
| **Union we design to** | **288** | **672** | **65** | **192** | derived |

Rules:

1. All text sits in the box **x 65 to 888, y 288 to 1248** (823 x 960 px), the union of the rows above.
2. Center text on x about 476 (the box center, not the frame center), because the right rail is wider.
3. The top 288 px may hold only non-critical artwork. No text there that the viewer must read.
4. No text in the bottom 672 px. The picture still fills it.
5. A caption line is never wider than 823 px.

## 2. Per-platform sheet

### 2.1 TikTok

- **Ratios:** 9:16 recommended. 16:9 and 1:1 are accepted ([ads spec](https://ads.tiktok.com/help/article/video-ads-specifications), retrieved November 20, 2026) [ADS]. Use 9:16 for everything.
- **Resolution, codec:** API accepts MP4 (recommended), WebM, MOV. H.264 recommended, H.265, VP8 and VP9 also accepted. 23 to 60 fps, 360 to 4096 px per side, **max 4 GB** ([developers.tiktok.com media transfer guide](https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide), retrieved November 20, 2026) [API].
- **Length:** API: "Standard creators can post 3-minute videos, and some can post 5- or 10-minute videos" [API]. Studio web reportedly allows up to 60 min [3P] ([Metricool](https://metricool.com/tiktok-video-length/)). Through a scheduler, plan for 3 min max.
- **Recommended length:** not verified from TikTok. Creator Rewards needs videos of at least 1 minute [3P] ([timetopost](https://timetopost.co/blog/tiktok-creator-rewards-requirements-2026/)). That matters only to accounts that qualify for the program.
- **Caption:** 2,200 characters (UTF-16) through the API, which is what schedulers hit. 4,000 in-app [3P] ([Hootsuite](https://www.hootsuite.com/whats-new/expanded-tiktok-caption-length-in-create), [adaptlypost](https://adaptlypost.com/blog/tiktok-caption-character-limit)). The on-screen truncation point is not documented. Put the hook in the first line.
- **Hashtags:** "captions, sounds, and hashtags" are recommendation inputs ([TikTok newsroom](https://newsroom.tiktok.com/how-tiktok-recommends-videos-for-you?lang=en), June 18, 2020) [OFF]. No official count. Use 3 to 5 specific tags [PRAC].
- **Ranking (official):** likes, shares, follows, comments. Video information such as captions, sounds and hashtags also counts. Finishing a longer video is a strong signal and gets more weight than weak signals. "neither follower count nor whether the account has had previous high-performing videos are direct factors" (same newsroom post) [OFF].
- **Originality:** "Content is also ineligible for the FYF if it includes unoriginal or reused material without anything new" ([Integrity and Authenticity](https://www.tiktok.com/community-guidelines/en/integrity-authenticity), effective September 24, 2026) [OFF]. A TikTok invisible watermark is applied to AI content made with TikTok tools and to C2PA uploads ([newsroom, November 19, 2025](https://newsroom.tiktok.com/more-ways-to-spot-shape-and-understand-ai-content?lang=en)) [OFF].
- **Links:** none in captions (not verified).
- **Cover:** not verified. Make frame 1 a readable title frame anyway.
- **Cadence, small account:** 1 post a day, every day [PRAC]. TikTok reportedly said posting time does not matter (April 2026, secondhand via [Shopify](https://www.shopify.com/ae/blog/best-time-to-post-on-tikok)) [3P].

### 2.2 Instagram Reels

- **Ratios:** 9:16 recommended. Accepted range 0.01:1 to 10:1 ([IG Graph API media reference](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media), retrieved November 21, 2026) [API].
- **Spec (API, binding for schedulers):** MP4 or MOV with moov atom at the front and no edit lists. HEVC or H.264, progressive, closed GOP, 4:2:0. 23 to 60 fps. Up to 1920 px wide. **VBR up to 25 Mbps**. AAC up to 48 kHz, 128 kbps. **3 s to 15 min. 300 MB max** [API].
- **Length:** in-app Reels went to 3 minutes on January 20, 2025 ([Business Today](https://www.businesstoday.in/technology/news/story/instagram-head-announces-big-changes-3-minute-reels-and-new-look-for-profile-grid-461527-2025-01-21)) [3P reporting the head of Instagram]. API allows 15 min.
- **Cover:** JPEG, 8 MB max, sRGB. Without a 9:16 original, the middle 9:16 is used. Feed shares use "the middle 1:1 square". `thumb_offset` picks a frame in ms. `cover_url` wins if both are set [API]. The profile grid crops to 3:4 (1080x1440 of the 1080x1920 cover) [3P] ([Kapwing](https://www.kapwing.com/resources/instagrams-new-grid-layout-size-and-dimensions-2025/), [Buffer](https://buffer.com/resources/instagram-grid/)). Keep the cover title inside the center 1080x1080, which survives both the 1:1 and the 3:4 crop.
- **Caption:** 2,200 characters, 20 mentions [API]. Truncation is about 125 characters in feed [3P] and possibly about 55 on the Reels tab [3P, unverified] ([Sendible](https://www.sendible.com/insights/instagram-character-limit)). Put the hook in the first 55 characters.
- **Hashtags:** API still says 30, but Instagram capped posts and Reels at **5 hashtags** on December 19, 2025 ([Business Today](https://www.businesstoday.in/technology/news/story/no-more-hashtag-stuffing-instagram-limits-hashtag-usage-to-just-5-per-reel-and-post-507444-2025-12-19), [Social Media Today](https://www.socialmediatoday.com/news/instagrams-implementing-new-limits-on-hashtag-use/808309/)) [3P reporting the head of Instagram]. Hashtags help search, not reach (same reports). Use 3 to 5.
- **Ranking:** Reels predictions include how likely you are to reshare, "watch a reel all the way through", like, or open the audio page. Demoted: "low-resolution or watermarked reels, reels that are muted or contain borders", "reels that are majority text", and "reels that have already been posted on Instagram" ([ranking explained](https://about.instagram.com/blog/announcements/instagram-ranking-explained), May 31, 2023) [OFF]. In early 2025 the head of Instagram named **watch time, likes per reach and sends per reach** as the top signals. Sends matter most for non-follower reach ([Social Media Today](https://www.socialmediatoday.com/news/instagram-shares-algorithm-insights-2025/738034/)) [3P reporting the head of Instagram].
- **Originality:** since April 30, 2026, accounts that mostly post unoriginal content "will no longer be eligible for recommendations across Instagram". "just adding a border, watermark, subtitles, or a credit" does not count as original. Accounts recover when "a significant percentage" of posts in a 30-day period are original ([creators.instagram.com](https://creators.instagram.com/blog/rewarding-original-creators-on-instagram), April 30, 2026) [OFF]. A creator's own stream is original. Do not mix in other people's clips.
- **AI label:** see section 0, point 4.
- **Links:** caption links are not clickable (not verified). Use the bio, Stories link stickers or comments.
- **Trial or test reels:** not covered by any source read here. Availability on an account and posting through a scheduler are unverified until checked in the app.
- **Cadence, small account:** 4 to 7 Reels a week [PRAC].

### 2.3 Instagram feed and carousel

- **Every standalone video is a Reel.** The API's `VIDEO` media type stopped working for feed posts on November 9, 2023. Standalone video must use `REELS` ([Meta Graph API changelog, June 28, 2022, read via search snippet](https://developers.facebook.com/docs/graph-api/changelog/out-of-cycle-changes/june-28-2022)) [API]. A 4:5 or 1:1 video export therefore only reaches Instagram as a **carousel slide**.
- **Carousel:** captions go on the container, not on the items. Item count conflicts: 20 items on the IG User Media reference versus 10 on the Content Publishing page [API, both read November 21, 2026]. Plan for 10. "Carousel images are all cropped based on the first image", default 1:1. Image range is 4:5 to 1.91:1 [API].
- **Tall feed ratio:** 4:5 (1080x1350) versus 3:4 (1080x1440). Sources disagree, and all are [3P] ([Kapwing](https://www.kapwing.com/resources/instagrams-new-grid-layout-size-and-dimensions-2025/), [Sked](https://skedsocial.com/blog/best-instagram-image-and-video-size-recommendations)). The API's 4:5 minimum for carousel images makes **4:5** the safe choice.
- **Originality rules extend to photos and carousels** (April 30, 2026, see 2.2) [OFF].
- **When it wins:** a "5 moments from the stream" carousel, with a 4:5 video first slide and stills or text after. It catches the save and send signals. Make it occasionally, not per clip [PRAC].

### 2.4 Facebook Reels and feed

- **All Facebook videos are Reels**, and "Reels on Facebook will also not have any length or format restrictions" ([about.fb.com](https://about.fb.com/news/2025/06/making-it-easier-create-videos-facebook/), June 17, 2025, updated July 14, 2025) [OFF]. The same 9:16 master serves.
- **Spec (ads proxy):** 9:16 recommended, no maximum duration, 4 GB. H.264 with square pixels, fixed frame rate and progressive scan. Stereo AAC at 128 kbps or more. "should not contain edit lists" ([FB Reels ads guide](https://www.facebook.com/business/ads-guide/update/video/facebook-facebook-reels), retrieved November 20, 2026) [ADS]. Text-safe zone: 14% top, 35% bottom, 6% sides [ADS].
- **Originality:** repeat reusers lose monetization and "receive reduced distribution on everything they share". Duplicate copies are demoted. "simply stitching together clips or adding your watermark does not qualify as meaningful enhancement" ([creators.facebook.com](https://creators.facebook.com/blog/combating-unoriginal-content), July 14, 2025) [OFF].
- **Caption and hashtags:** the creators blog says to keep "captions and hashtags relevant" [OFF]. Length limits were not verified.
- **Cadence:** upload each Instagram Reel natively as well (a separate upload of the same master, not a share with a watermark) [PRAC].

### 2.5 YouTube Shorts

- **Classification:** square or vertical, up to **3 minutes**, counts as a Short. 16:9 keeps a video long-form ([answer/15424877](https://support.google.com/youtube/answer/15424877?hl=en), retrieved November 20, 2026) [OFF]. **A 1:1 export uploaded to YouTube becomes a Short.**
- **Music:** Shorts Audio Library tracks run up to 90 s in a 3-min Short. Some are capped at 30 or 60 s. Claimed Shorts over 1 min are blocked globally [OFF].
- **Encoding:** H.264 High, closed GOP, 2 B-frames, 4:2:0, VBR, MP4 with faststart, BT.709. **8 Mbps at 1080p 24 to 30 fps, 12 Mbps at 1080p 48 to 60 fps.** AAC-LC 48 kHz, stereo 384 kbps. Keep the source frame rate ([answer/1722171](https://support.google.com/youtube/answer/1722171?hl=en), retrieved November 20, 2026) [OFF].
- **Text-safe zone:** 288 top, 672 bottom, 48 left, 192 right [ADS, Google PDF]. Text only; the picture fills the frame.
- **Thumbnail:** custom Shorts thumbnails in YouTube Studio on desktop only, with a verified account. 9:16, **2160x3840** recommended, minimum height 640, JPG or PNG, 50 MB on desktop ([answer/72431](https://support.google.com/youtube/answer/72431?hl=en), retrieved November 21, 2026) [OFF]. The YouTube blog says custom Shorts thumbnails are for YPP creators ([blog.youtube](https://blog.youtube/news-and-events/youtube-studio-custom-thumbnail-updates/)) [OFF]. Access may vary.
- **Title and description:** 100 and 5,000 characters ([answer/57407](https://support.google.com/youtube/answer/57407)) [OFF]. The Shorts feed shows the title over the video. Keep it under about 40 characters so it fits one line (not verified; check in the app).
- **Hashtags:** up to 3 show by the title. **More than 60 and all are ignored** ([answer/6390658](https://support.google.com/youtube/answer/6390658?hl=en)) [OFF]. Use 2 or 3.
- **Links:** description links are not clickable. Use the Related video link (section 0, point 5) [OFF].
- **Ranking:** no official 2026 Shorts ranking doc was found. Since March 31, 2025, a view counts every start or replay. "Engaged views" keep the old definition and drive revenue and YPP ([TechCrunch](https://techcrunch.com/2025/03/26/youtube-is-changing-how-youtube-shorts-views-are-counted)) [3P reporting YouTube]. Use "Viewed vs. swiped away" in Studio Reach as the hook metric [3P]. Low views with low viewed-vs-swiped point at the open.
- **Cadence:** "consistency is key" ([answer/12921536](https://support.google.com/youtube/answer/12921536)) [OFF]. 1 a day [PRAC].

### 2.6 YouTube long-form

- **Ratio:** 16:9, 1920x1080 (or 3840x2160). Same encoding table as 2.5, with 2160p at 35 to 45 Mbps (30 fps) or 53 to 68 Mbps (60 fps) [OFF].
- **Limits:** 15 min by default, longer once verified. "256 GB or 12 hours, whichever is less" ([answer/71673](https://support.google.com/youtube/answer/71673?hl=en)) [OFF].
- **Thumbnail:** 16:9, 3840x2160 recommended, minimum width 640, 50 MB on desktop and 2 MB on mobile [OFF].
- **Use for clips:** a weekly 8 to 12 min "best of the stream" cut (`scripts/compile_wide.py`), and the full VOD, serve as the Related-video targets for every Short [C]. Same reused and inauthentic rules as 0.3.

### 2.7 X video

- **API limits (binding for schedulers):** H.264 High, AAC-LC at 128 kbps or more, 30 or 60 fps (no more than 60). Minimum video bitrate 5,000 kbps. Recommended sizes are 1280x720, 720x1280 or 720x720. "Premium users can get 1080p playback". Aspect 1:3 to 3:1, with 16:9 or 1:1 recommended. Post video **up to 20 min and 8 GB by default**, 125 min and 16 GB for Premium or verified ([docs.x.com media best practices](https://docs.x.com/x-api/media/quickstart/best-practices), retrieved November 20, 2026) [API].
- **Conflict:** the X help center says non-Premium users can upload up to **140 s** in the apps, while Premium gets up to 4 h at 1080p on web and iOS ([help.x.com premium longer videos](https://help.x.com/en/using-x/premium-longer-videos), via search snippet; direct fetch returned 403) [OFF]. Keep X clips at 140 s or less.
- **Text:** 280 characters, or 25,000 with Premium long posts ([help.x.com via search](https://help.x.com/articles/119138); [counting characters](https://docs.x.com/fundamentals/counting-characters.md)) [OFF].
- **Ranking (open-sourced code):** a weighted sum of predicted actions. These include favorite, reply, repost, quote, share, share via DM, share via copy link, video quality view, dwell time and "video continuation seconds". Negatives include not interested, mute, block, report and "not dwelled". Out-of-network posts get "a factor below 1", and an author's later posts in a session decay ([github.com/xai-org/x-algorithm](https://github.com/xai-org/x-algorithm), retrieved November 20, 2026) [OFF]. No link-specific penalty appears in the code.
- **Ratio choice:** 9:16 plays but takes the full screen only on tap. In the timeline, a **4:5** export shows larger than 16:9 and is less cropped than 9:16 [PRAC]. Use 4:5 for X on the top clips.
- **Hashtags:** not verified. Use 0 or 1 [PRAC].
- **Cadence:** daily, with the clip as a native upload and the stream link in a reply [PRAC].

### 2.8 LinkedIn video

- **Limits:** 75 KB to 5 GB. 3 s (desktop) or 2 s (mobile) to **15 min**. 256x144 to 4096x2304. **Aspect 1:2.4 to 2.4:1** (9:16 fits). 10 to 60 fps. **192 kbps to 30 Mbps**. MP4 and MOV among others ([linkedin.com/help a548372](https://www.linkedin.com/help/linkedin/answer/a548372), retrieved November 20, 2026) [OFF].
- **Ratio choice:** LinkedIn recommends 1:1 or 9:16 per [Social Media Today](https://www.socialmediatoday.com/news/linkedin-shares-video-creation-tips/744933/) [3P reporting LinkedIn]. A vertical video feed exists ([TechCrunch, February 4, 2025](https://techcrunch.com/2025/02/04/linkedin-amps-up-vertical-video-tools-as-uploads-jump-36)) [3P]. Use the 9:16 master for the video feed, or 4:5 for the main feed on the best clips.
- **Thumbnail and captions:** you can add a thumbnail and pick captions after upload. Auto-captions cover 10 languages ([linkedin help a7486279](https://www.linkedin.com/help/linkedin/answer/a7486279)) [OFF]. Videos autoplay muted, so burned-in captions are required [PRAC].
- **Text:** 3,000 characters. The "see more" cutoff is about 210 characters but is not official [3P] ([eden.so](https://eden.so/blog/linkedin-character-limits/)).
- **Ranking:** dwell time is a documented ranking input (LinkedIn engineering 2020, plus the LiRank and LiGR papers, cited by [webtures](https://www.webtures.com/insights/linkedin-algorithm-2026/)) [3P citing OFF]. Creators see views, total watch time and average watch time [3P].
- **Hashtags and links:** no official guidance was found. Use 0 to 3 hashtags. Put links in the first comment [PRAC].
- **Fit:** work and coding clips belong here. Gaming clips usually do not [C].
- **Cadence:** 2 to 3 a week [PRAC].

### 2.9 Threads

- **Spec (API):** MOV or MP4 with moov atom at the front. HEVC or H.264, closed GOP, 4:2:0. 23 to 60 fps. Up to 1920 px wide. Aspect 0.01:1 to 10:1, with 9:16 recommended. VBR up to 100 Mbps. AAC 48 kHz, 128 kbps. **Up to 300 s, 1 GB** ([developers.facebook.com Threads overview](https://developers.facebook.com/documentation/threads/overview), retrieved November 20, 2026) [API].
- **Text:** 500 characters [API]. Topic tag 1 to 50 characters [API]. One tag per post [3P] ([NewsBytes](https://www.newsbytesapp.com/news/science/instagram-caps-hashtag-usage-to-5-per-post-here-s-why/story)).
- **Links:** the head of Instagram said in June 2025 that links are now "ranked properly" ([Social Media Today](https://www.socialmediatoday.com/news/meta-says-link-posts-ranked-properly-threads-reach/750126/)) [3P reporting the head of Instagram]. Link the stream VOD directly.
- **AI label:** the Meta rule applies (section 0, point 4).
- **Cadence:** 1 to 2 a day, text first with the clip attached [PRAC].

### 2.10 Telegram channel

- **Limits:** 2 GB per file, 4 GB with Premium ([upload_max_fileparts](https://core.telegram.org/api/config) 4000 or 8000 parts of 512 KB, retrieved November 21, 2026) [API]. Media captions are **1,024** characters, or 4,096 with Premium (`caption_length_limit_default` / `_premium`, same page) [API].
- **Bot API (what schedulers use):** "Bots can currently send video files of up to 50 MB in size" ([core.telegram.org/bots/api](https://core.telegram.org/bots/api)) [API]. That makes **50 MB the binding limit**, so render the size-capped preset P5.
- **Ranking:** no algorithmic feed. Reach equals subscribers plus forwards. Write a caption that asks for a forward [PRAC].
- **Ratio:** 9:16 plays fine. Send it as a streamable MP4 with faststart [PRAC].

### 2.11 Discord

- **Upload limits:** free accounts get **20 MB** since August 2026 (up from 10 MB). Nitro Basic gets 50 MB and Nitro "up to 1GB". MP4 video in H.264, HEVC or AV1 embeds inline ([Discord File Attachments FAQ](https://support.discord.com/hc/en-us/articles/25444343291031), updated November 19, 2026, read through the Zendesk API) [OFF]. **Conflict:** the Account Caps table (updated November 21, 2026) still lists 10 MB, 50 MB and 500 MB [OFF]. Bot and webhook limits were not verified, so size to **10 MB** to be safe.
- **Message length:** 2,000 characters, or 4,000 with Nitro (Account Caps) [OFF].
- **Better option:** post the YouTube Short or VOD link, which embeds a player. Upload a file only for a teaser under 10 MB (preset P6) [PRAC].

## 3. Ratio decision: which crops are worth making

| Ratio | Where it wins | Verdict |
|---|---|---|
| 9:16 1080x1920 | TikTok, Reels (IG and FB), Shorts, Threads, LinkedIn video feed, Telegram | **Always.** This is the master. |
| 4:5 1080x1350 | X timeline, LinkedIn main feed, Instagram carousel first slide, Facebook feed | **Top 20% of clips only** [C]. Gameplay and screen content gain from the extra width over 9:16. On Instagram a 4:5 export reaches people only inside a carousel, because standalone video is a Reel. |
| 1:1 1080x1080 | nowhere that 4:5 does not already beat | **Skip.** On YouTube a square video becomes a Short. A carousel can use 4:5. |
| 16:9 1920x1080 | YouTube long-form, X and LinkedIn when the clip is a wide screen demo | **Weekly compilation only**, plus the stream VOD. |

## 4. One clip, N exports

`scripts/export.py <master> --preset P1 --out <dir>` renders one preset from `scripts/presets.json`. Size-capped presets (P5, P6) compute their bitrate from the clip length. Common flags for every video preset: `-c:v libx264 -profile:v high -pix_fmt yuv420p -bf 2 -g <2*fps> -keyint_min <2*fps> -sc_threshold 0 -colorspace bt709 -color_primaries bt709 -color_trc bt709 -movflags +faststart -c:a aac -ar 48000 -ac 2`. Keep the source frame rate: 30 if the stream was 30, 60 if it was 60. Do not convert 30 to 60. Loudness is set once, on the master (`cut_short.py`, -14 LUFS, true peak at or under -1 dBFS) [PRAC; no platform doc read]; `export.py` does not normalise again. Never burn a platform logo or watermark into any export.

| ID | Size | fps | Video | Audio | Max length | Serves | Notes |
|---|---|---|---|---|---|---|---|
| **P1 master vertical** | 1080x1920 | source (30 or 60) | VBR `-b:v 10M -maxrate 16M -bufsize 20M` at 60 fps, `-b:v 8M -maxrate 12M -bufsize 16M` at 30 fps, level 4.2 | AAC-LC 48 kHz stereo 256k | 180 s | TikTok, IG Reels, FB Reels, YT Shorts, Threads, LinkedIn, X (Premium) | Peak stays under the IG API 25 Mbps cap. A 180 s clip is at most ~230 MB, under IG's 300 MB. Matches YouTube's 8 and 12 Mbps. Text inside the 823x960 text-safe box; picture edge to edge. |
| **P2 X free fallback** | 720x1280 | 30 | `-b:v 5M -maxrate 6M -bufsize 10M` | AAC 128k | 140 s | X when the account is not Premium | X API minimum is 5,000 kbps. Free playback is 720p anyway. |
| **P3 feed 4:5** | 1080x1350 | source | `-b:v 8M -maxrate 12M -bufsize 16M` | AAC 192k | 180 s; X takes 140 s (`export.py` prints a note over 140 s and still writes the file) | X timeline, LinkedIn main feed, IG carousel slide 1, FB feed | Recrop, do not letterbox (Meta demotes borders). Text-safe area 14% top, 20% bottom [PRAC]. Top clips only. |
| **P4 long 16:9** | 1920x1080 | source | YouTube table: 8M at 30 fps, 12M at 60 fps | AAC 384k | none | YouTube long-form compilation, X or LinkedIn for wide demos | Use the original stream framing. |
| **P5 Telegram capped** | 1080x1920; drop to 720x1280 if the computed video bitrate is under 3 Mbps | source, 30 max | 2-pass ABR: `kbps = (48*8000/sec) - 128`, then minus 5% | AAC 128k | any | Telegram through a Bot API scheduler (50 MB) | A 60 s clip gets about 6.0 Mbps at 1080p. A 120 s clip gets about 3.0 Mbps, so use 720p. |
| **P6 Discord teaser** | 720x1280 | 30 | 2-pass ABR: `kbps = (9.5*8000/sec) - 96`, then minus 5% | AAC 96k | 30 s | Discord file upload | 10 MB is safe for every tier and for webhooks. A 30 s clip gets about 2.3 Mbps. Otherwise post the YouTube link. |
| **C1 vertical cover** | 1080x1920 JPG sRGB, under 8 MB | - | - | - | - | IG Reels `cover_url`, TikTok cover, FB | Title inside the center 1080x1080 (survives both the 1:1 feed-share crop and the 3:4 grid crop). |
| **C2 Shorts thumbnail** | 2160x3840 JPG or PNG, under 50 MB | - | - | - | - | YT Shorts (desktop Studio, verified or YPP) | Same artwork as C1, upscaled from the vector or 4K source. |
| **C3 long thumbnail** | 3840x2160 JPG | - | - | - | - | YT long-form | - |

`export.py` renders P1 to P6 and C1. C2 and C3 are specifications for artwork made elsewhere, not presets of the script.

Example P5 bitrate for a 75 s clip: 48 x 8000 / 75 = 5120, minus 128 = 4992, minus 5% gives **about 4.7 Mbps** video at 1080x1920 in 2-pass.

Per clip that means two renders (P1 plus C1). Add P5 when it goes to Telegram, P3 for the top clips, and P2 or P6 only when needed. One P1 file covers 7 of the 11 surfaces.

## 5. Per-platform treatment

Posting slots below are starting guesses [C], in the audience's local time. No source gives a verified slot for an account. Replace them with each platform's own analytics after 10 posts there.

| Platform | Export | Caption pattern | On-screen text differences | Call to action | Hashtags | Starting slot (guess) |
|---|---|---|---|---|---|---|
| TikTok | P1 + C1 | First line is the hook (under 100 characters), then one sentence of context. 2,200 max through the API | Native look: no top artwork, title bar plus captions only. Text inside the box (wide right rail) | A one-word question to answer in the comments | 3 to 5, specific to the clip | 12:30 PM and 8:30 PM. Time may matter little [3P] |
| Instagram Reels | P1 + C1; P3 as carousel slide 1 for an occasional "best of" | Hook in the first 55 characters, one line of context, then the question | Same as P1. Cover title inside the center 1080x1080 | Ask for sends: "Send this to the friend who [does X]" | 3 to 5 (cap is 5) | 7:00 PM |
| Instagram Reels, translated account (for example `es`) | Separate render of P1 with the title bar and captions translated; original voice stays | Caption in the target language, hook in the first 55 characters | All on-screen text translated by meaning and read by a native speaker. Never repost the original-language file | Ask for sends, in the target language | 3 to 5 | Midday in the audience's zone |
| Facebook | P1, separate upload (not a share from Instagram) | 1 to 2 lines: hook plus question | Same as P1 | A question in the caption | 0 to 2 | 1:00 PM |
| YouTube Shorts | P1 + C2 if custom Shorts thumbnails are enabled | Title under 40 characters if possible (100 max): a known name or pain plus one number or strong word, no product name. Description: 2 lines, the stream link, 2 to 3 hashtags | Same as P1. Clips with game audio 60 s or less | Set the **Related video** link to the source stream; pin a comment with the question | 2 to 3 | 12:00 PM and 6:30 PM, at most 2 a day |
| X | P3 4:5 for top clips, else P1; P2 if the account is not Premium (140 s cap) | Hook plus one line, under 280 characters; stream link in a reply, not the post | 4:5 recrop keeps the title bar inside the frame | A question to reply to | 0 to 1 | 9:30 AM, top clips also 5:00 PM |
| LinkedIn | P1 or P3 for the best work clips. No gaming clips [C] | First 210 characters carry the hook and the lesson; 3 to 5 short lines on what went wrong and what fixed it | Same as P1; burned captions required (autoplay is muted) | A question to peers; link in the first comment | 0 to 3 | Tuesday to Thursday, 8:30 AM, 2 to 3 a week |
| Threads | P1 | Text first, under 500 characters: hook plus question; one topic tag | Same as P1 | Link the stream VOD directly | 1 topic tag | 10:00 AM and 8:00 PM |
| Telegram | P5, in the channel's language | Under 1,024 characters: what happened, why it matters, the stream link | Same render as the matching Instagram language | Ask for a forward | 0 to 2 | Midday in the audience's zone |
| Discord | The YouTube Short link (embeds a player); P6 file only for a teaser under 30 s | 1 to 2 lines plus "answer in the thread" | none (embed) | Start a thread with the question | none | 1 h after the YouTube post |

Rules that go with the table:

1. **Wave rule [C].** Day 0 and day 1 of a clip go only to the short-video feeds that show posts to non-followers: YouTube Shorts, TikTok and Instagram Reels. Facebook, X, Threads, LinkedIn, Telegram and Discord get the clip only after it passes the winner line in `references/retention.md`. No clip goes everywhere on one day.
2. **Trial or test reels.** Any "trial" or test-reel feature, whether it counts against a daily cap, and whether a winning trial can be shared to the grid, are unverified until checked in the app and in the scheduler. If they cannot be posted through the scheduler, the account owner posts the variants in the app.
3. **Translations.** A translated version goes only to a clip that already passed the winner line, and only after a native read.
4. Routing to accounts and approval of each post belong to `social-media-posting`, not to this file.

## 6. Open items to check in the app before the first batch

- TikTok on-screen caption truncation, and cover selection through the scheduler.
- Whether the YouTube channel has custom Shorts thumbnails enabled (they need a verified account, possibly YPP).
- Whether the X account is Premium, which decides between 140 s and 1080p.
- The Instagram Reels-tab caption truncation (55 characters, unverified).
- Whether trial or test reels exist on the Instagram account and can be posted through the scheduler.
- The Discord webhook upload limit.
