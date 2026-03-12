---
description: "This skill should be used when the user asks to 'post to Instagram', 'publish a carousel', 'share a photo', 'upload a video to Instagram', or 'create an Instagram post'. Activate whenever the user wants to publish image carousels, single images, videos, reels, or text captions to Instagram from their personal or business account. Also triggers for 'schedule an Instagram post', 'post multiple images', or 'publish reel'."
allowed-tools: Bash, Read, Write
---

# /instagram-poster

Publish content to Instagram directly from your local instance. Supports single images, image carousels (up to 10 slides), videos/reels, and rich captions with hashtags.

Execute each step immediately. Run Bash commands directly — do not ask for permission or describe plans.

## Prerequisites

This skill uses the Instagram Graph API. Before running:
- `INSTAGRAM_ACCESS_TOKEN` — long-lived token with `instagram_content_publish` scope
- `INSTAGRAM_ACCOUNT_ID` — numeric Instagram Business/Creator account ID
- Media files must be publicly accessible URLs **or** local files (uploaded via a CDN/signed URL first)

Check for existing credentials before prompting:

```bash
grep -q INSTAGRAM_ACCESS_TOKEN .env 2>/dev/null && echo 'found' || echo 'missing'
```

## Content Types

| Type | Description | Max |
|------|-------------|-----|
| `IMAGE` | Single photo post | 1 image |
| `CAROUSEL` | Multi-image swipeable post | 2–10 images |
| `REELS` | Short vertical video | 1 video (≤90s) |

## Workflow

### Step 1 — Load credentials. Run this immediately:

```bash
export $(grep -E 'INSTAGRAM_ACCESS_TOKEN|INSTAGRAM_ACCOUNT_ID' .env | xargs)
echo "Account: $INSTAGRAM_ACCOUNT_ID"
```

### Step 2 — Validate assets and caption

Before publishing, confirm:
- Images: JPEG or PNG, minimum 320×320px, aspect ratio 4:5 to 1.91:1
- Videos: MP4/MOV, H.264, AAC audio, 9:16 ratio for Reels
- Caption: max 2200 characters, up to 30 hashtags
- Alt text: optional but recommended for accessibility

For local files, generate a public URL first (e.g., using `curl` to upload to a temp host, or an S3 presigned URL from your existing bucket).

### Step 3 — Create media container(s)

**Single image:**
```bash
curl -s -X POST \
  "https://graph.facebook.com/v19.0/${INSTAGRAM_ACCOUNT_ID}/media" \
  -d "image_url=https://your-cdn.com/photo.jpg" \
  -d "caption=Your caption here #hashtag" \
  -d "access_token=${INSTAGRAM_ACCESS_TOKEN}" | jq '.id'
```

**Carousel — create each child item first (is_carousel_item=true):**
```bash
for url in "https://cdn/img1.jpg" "https://cdn/img2.jpg" "https://cdn/img3.jpg"; do
  curl -s -X POST \
    "https://graph.facebook.com/v19.0/${INSTAGRAM_ACCOUNT_ID}/media" \
    -d "image_url=${url}" \
    -d "is_carousel_item=true" \
    -d "access_token=${INSTAGRAM_ACCESS_TOKEN}" | jq -r '.id'
done
```

Then create the carousel container using collected child IDs:
```bash
curl -s -X POST \
  "https://graph.facebook.com/v19.0/${INSTAGRAM_ACCOUNT_ID}/media" \
  -d "media_type=CAROUSEL" \
  -d "children=CHILD_ID_1,CHILD_ID_2,CHILD_ID_3" \
  -d "caption=Carousel caption #tag" \
  -d "access_token=${INSTAGRAM_ACCESS_TOKEN}" | jq '.id'
```

**Reel/video:**
```bash
curl -s -X POST \
  "https://graph.facebook.com/v19.0/${INSTAGRAM_ACCOUNT_ID}/media" \
  -d "media_type=REELS" \
  -d "video_url=https://your-cdn.com/reel.mp4" \
  -d "caption=Reel caption #fyp" \
  -d "share_to_feed=true" \
  -d "access_token=${INSTAGRAM_ACCESS_TOKEN}" | jq '.id'
```

### Step 4 — Poll for upload readiness (video/carousel only)

For videos, wait until `status_code` is `FINISHED` before publishing:
```bash
CONTAINER_ID="your_container_id"
while true; do
  STATUS=$(curl -s "https://graph.facebook.com/v19.0/${CONTAINER_ID}?fields=status_code&access_token=${INSTAGRAM_ACCESS_TOKEN}" | jq -r '.status_code')
  echo "Status: $STATUS"
  [ "$STATUS" = "FINISHED" ] && break
  [ "$STATUS" = "ERROR" ] && echo 'Upload failed' && exit 1
  sleep 5
done
```

### Step 5 — Publish the container. Run this immediately:

```bash
curl -s -X POST \
  "https://graph.facebook.com/v19.0/${INSTAGRAM_ACCOUNT_ID}/media_publish" \
  -d "creation_id=${CONTAINER_ID}" \
  -d "access_token=${INSTAGRAM_ACCESS_TOKEN}" | jq '.id'
```

A successful response returns a numeric post ID. Confirm with:
```bash
curl -s "https://graph.facebook.com/v19.0/${POST_ID}?fields=permalink&access_token=${INSTAGRAM_ACCESS_TOKEN}" | jq -r '.permalink'
```

## Caption Best Practices

- Lead with the hook in the first 125 chars (shown before 'more')
- Add a line break before hashtag block: use `\n\n` in the API call
- Group hashtags at the end or in the first comment (post the comment via `/comments` endpoint)
- For carousels: caption applies to the whole post, not individual slides

## Error Handling

| Error Code | Cause | Fix |
|------------|-------|-----|
| `(#36000)` | Container not ready | Poll `status_code` longer |
| `(#9007)` | Image aspect ratio | Crop to 4:5 or 1:1 |
| `(#352)` | Token expired | Refresh long-lived token |
| `(#100)` | Invalid media URL | Ensure URL is publicly reachable |

## Output

After successful publish, output:
- Post ID
- Permalink URL
- Content type and slide count (for carousels)
- Timestamp
