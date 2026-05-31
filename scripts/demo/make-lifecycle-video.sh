#!/usr/bin/env bash
#
# make-lifecycle-video.sh
# ------------------------
# Post-process the Skill Studio lifecycle demo recording into a shippable MP4:
#
#   [ ~3s intro title card ]  +  [ re-encoded screen recording ]  ->  output.mp4
#
# Usage:
#   scripts/demo/make-lifecycle-video.sh [INPUT.webm] [OUTPUT.mp4]
#
# Defaults:
#   INPUT  = e2e/demo-output/lifecycle-demo.webm
#   OUTPUT = e2e/demo-output/lifecycle-demo.mp4
#
# Notes:
#   * Targets ffmpeg 8.x (tested with 8.0.1 at /opt/homebrew/bin/ffmpeg).
#   * The intro title card is rendered with ffmpeg `drawtext` when that filter
#     is compiled in. Homebrew's stock ffmpeg ships WITHOUT libfreetype/drawtext,
#     so we transparently fall back to rendering the card PNG via Python/PIL.
#   * Everything is normalized to 1440x900 / 30fps / h264 yuv420p with a silent
#     AAC track, so the intro and body concatenate cleanly via the concat demuxer.
#
set -euo pipefail

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
FFMPEG="${FFMPEG:-/opt/homebrew/bin/ffmpeg}"
command -v "$FFMPEG" >/dev/null 2>&1 || FFMPEG="ffmpeg"

W=1440
H=900
FPS=30
CRF=20
BG="0x1a1814"           # studio dark background
INTRO_SECS=3

TITLE="Skill Studio"
# NOTE: the arrow is ASCII "->" (not U+2192) and the dash is "-" because the
# stock macOS Helvetica.ttc lacks those glyphs and renders them as tofu boxes.
SUBTITLE="Submit & update a skill - anton-grid v1.0.0 -> v1.0.1"
FOOTER="verified-skill.com"

INPUT="${1:-e2e/demo-output/lifecycle-demo.webm}"
OUTPUT="${2:-e2e/demo-output/lifecycle-demo.mp4}"

# Allow the caller to render JUST the intro card (verification mode) without a body.
# INTRO_ONLY=1 INTRO_OUT=/tmp/card.mp4 make-lifecycle-video.sh
INTRO_ONLY="${INTRO_ONLY:-0}"
INTRO_OUT="${INTRO_OUT:-}"

# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
log()  { printf '\033[36m[make-video]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[31m[make-video] ERROR:\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/lifecycle-video.XXXXXX")"
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

# Probe a usable system font (first existing wins).
pick_font() {
  local f
  for f in \
    /System/Library/Fonts/Helvetica.ttc \
    /System/Library/Fonts/SFNS.ttf \
    /System/Library/Fonts/Supplemental/Arial.ttf \
    /System/Library/Fonts/Supplemental/Helvetica.ttc \
    /Library/Fonts/Arial.ttf \
    /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf ; do
    [ -f "$f" ] && { printf '%s' "$f"; return 0; }
  done
  return 1
}

# Does this ffmpeg have the drawtext filter compiled in?
has_drawtext() {
  "$FFMPEG" -hide_banner -filters 2>/dev/null | grep -qiw drawtext
}

# Probe whether a media file has an audio stream.
has_audio_stream() {
  local probe
  probe="$(command -v ffprobe || true)"
  [ -z "$probe" ] && probe="${FFMPEG%ffmpeg}ffprobe"
  [ -x "$probe" ] || command -v "$probe" >/dev/null 2>&1 || return 1
  "$probe" -v error -select_streams a -show_entries stream=index \
    -of csv=p=0 "$1" 2>/dev/null | grep -q .
}

# --------------------------------------------------------------------------- #
# Step 1: build the intro title card as a still PNG -> 3s faded clip
# --------------------------------------------------------------------------- #
FONT="$(pick_font || true)"
[ -n "$FONT" ] || die "no usable system font found (looked for Helvetica.ttc / SFNS.ttf / Arial.ttf)"
log "font: $FONT"

CARD_PNG="$WORKDIR/card.png"

render_card_png_with_pil() {
  log "rendering title card via Python/PIL (drawtext not available in this ffmpeg)"
  PY="$(command -v python3 || true)"
  [ -n "$PY" ] || PY=/usr/bin/python3
  [ -x "$PY" ] || command -v "$PY" >/dev/null 2>&1 || die "python3 not found and ffmpeg lacks drawtext"
  CARD_PNG="$CARD_PNG" W="$W" H="$H" BG="$BG" FONT="$FONT" \
  TITLE="$TITLE" SUBTITLE="$SUBTITLE" FOOTER="$FOOTER" \
  "$PY" - <<'PY'
import os
from PIL import Image, ImageDraw, ImageFont

W, H = int(os.environ["W"]), int(os.environ["H"])
bg_hex = os.environ["BG"].replace("0x", "").lstrip("#")
bg = tuple(int(bg_hex[i:i+2], 16) for i in (0, 2, 4))
font_path = os.environ["FONT"]
title    = os.environ["TITLE"]
subtitle = os.environ["SUBTITLE"]
footer   = os.environ["FOOTER"]

img = Image.new("RGB", (W, H), bg)
d = ImageDraw.Draw(img)

def font(sz):
    return ImageFont.truetype(font_path, sz)

def centered(text, f, y, fill):
    bbox = d.textbbox((0, 0), text, font=f)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    d.text(((W - tw) / 2 - bbox[0], y - bbox[1]), text, font=f, fill=fill)
    return th

title_f    = font(104)
subtitle_f = font(38)
footer_f   = font(26)

# Vertical rhythm: title block centered slightly above middle.
title_h = d.textbbox((0, 0), title, font=title_f)
title_h = title_h[3] - title_h[1]
title_y = int(H * 0.40) - title_h // 2

centered(title, title_f, title_y, (245, 242, 236))
# subtle accent rule under the title
rule_y = title_y + title_h + 34
rule_w = int(W * 0.34)
d.rectangle([(W - rule_w) // 2, rule_y, (W + rule_w) // 2, rule_y + 3],
            fill=(214, 138, 74))
centered(subtitle, subtitle_f, rule_y + 36, (176, 170, 160))
# footer pinned near the bottom
centered(footer, footer_f, int(H * 0.88), (120, 114, 104))

img.save(os.environ["CARD_PNG"])
print("card png written:", os.environ["CARD_PNG"])
PY
}

INTRO_CLIP="$WORKDIR/intro.ts"

build_intro_clip() {
  # Fade timing: fade in over first 0.6s, fade out over last 0.6s.
  local fade_out_start
  fade_out_start="$(awk "BEGIN{printf \"%.2f\", $INTRO_SECS - 0.6}")"

  if has_drawtext; then
    log "building intro via ffmpeg lavfi + drawtext"
    # Escape ':' and '\' for drawtext text values is unnecessary here since we
    # pass via textfile-free literals without those chars except the arrow/em-dash.
    "$FFMPEG" -y -hide_banner -loglevel error \
      -f lavfi -i "color=c=${BG}:size=${W}x${H}:rate=${FPS}:duration=${INTRO_SECS}" \
      -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=48000" \
      -vf "drawtext=fontfile='${FONT}':text='${TITLE}':fontsize=104:fontcolor=0xF5F2EC:x=(w-text_w)/2:y=h*0.40-th/2,\
drawtext=fontfile='${FONT}':text='${SUBTITLE}':fontsize=38:fontcolor=0xB0AAA0:x=(w-text_w)/2:y=h*0.40+90,\
drawtext=fontfile='${FONT}':text='${FOOTER}':fontsize=26:fontcolor=0x787268:x=(w-text_w)/2:y=h*0.88,\
fade=t=in:st=0:d=0.6,fade=t=out:st=${fade_out_start}:d=0.6,format=yuv420p" \
      -c:v libx264 -crf "$CRF" -preset medium -r "$FPS" \
      -c:a aac -b:a 128k -shortest \
      -t "$INTRO_SECS" \
      -bsf:v h264_mp4toannexb -f mpegts "$INTRO_CLIP"
  else
    render_card_png_with_pil
    log "building intro from PNG (fade in/out, ${INTRO_SECS}s)"
    "$FFMPEG" -y -hide_banner -loglevel error \
      -loop 1 -t "$INTRO_SECS" -i "$CARD_PNG" \
      -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=48000" \
      -vf "fade=t=in:st=0:d=0.6,fade=t=out:st=${fade_out_start}:d=0.6,format=yuv420p" \
      -c:v libx264 -crf "$CRF" -preset medium -r "$FPS" \
      -c:a aac -b:a 128k -shortest \
      -t "$INTRO_SECS" \
      -bsf:v h264_mp4toannexb -f mpegts "$INTRO_CLIP"
  fi
}

# --------------------------------------------------------------------------- #
# Intro-only verification short-circuit
# --------------------------------------------------------------------------- #
if [ "$INTRO_ONLY" = "1" ]; then
  [ -n "$INTRO_OUT" ] || die "INTRO_ONLY=1 requires INTRO_OUT=<path.mp4>"
  build_intro_clip
  "$FFMPEG" -y -hide_banner -loglevel error \
    -i "$INTRO_CLIP" -c copy -movflags +faststart "$INTRO_OUT"
  log "intro-only card written: $INTRO_OUT"
  exit 0
fi

# --------------------------------------------------------------------------- #
# Step 2: re-encode the body recording
# --------------------------------------------------------------------------- #
[ -f "$INPUT" ] || die "input recording not found: $INPUT
  Record the lifecycle demo first (default path: e2e/demo-output/lifecycle-demo.webm),
  or pass an explicit input path as arg 1."

mkdir -p "$(dirname "$OUTPUT")"

BODY_CLIP="$WORKDIR/body.ts"
log "re-encoding body: $INPUT -> h264 ${W}x${H} @ ${FPS}fps crf ${CRF}"

# Scale to fit inside 1440x900 preserving aspect, then pad to exact even dims.
SCALE_PAD="scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${BG},setsar=1,format=yuv420p"

if has_audio_stream "$INPUT"; then
  log "body has an audio stream -> preserving it"
  "$FFMPEG" -y -hide_banner -loglevel error \
    -i "$INPUT" \
    -vf "$SCALE_PAD" \
    -r "$FPS" \
    -c:v libx264 -crf "$CRF" -preset medium \
    -c:a aac -b:a 128k -ar 48000 -ac 2 \
    -bsf:v h264_mp4toannexb -f mpegts "$BODY_CLIP"
else
  log "body has no audio stream -> attaching silent track for concat uniformity"
  "$FFMPEG" -y -hide_banner -loglevel error \
    -i "$INPUT" \
    -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=48000" \
    -vf "$SCALE_PAD" \
    -r "$FPS" \
    -c:v libx264 -crf "$CRF" -preset medium \
    -c:a aac -b:a 128k -ar 48000 -ac 2 \
    -shortest \
    -bsf:v h264_mp4toannexb -f mpegts "$BODY_CLIP"
fi

# --------------------------------------------------------------------------- #
# Step 3: build the intro, then concat intro + body
# --------------------------------------------------------------------------- #
build_intro_clip

CONCAT_LIST="$WORKDIR/concat.txt"
{
  printf "file '%s'\n" "$INTRO_CLIP"
  printf "file '%s'\n" "$BODY_CLIP"
} > "$CONCAT_LIST"

log "concatenating intro + body -> $OUTPUT"
"$FFMPEG" -y -hide_banner -loglevel error \
  -f concat -safe 0 -i "$CONCAT_LIST" \
  -c copy -movflags +faststart "$OUTPUT"

# --------------------------------------------------------------------------- #
# Step 4: report
# --------------------------------------------------------------------------- #
[ -f "$OUTPUT" ] || die "concat produced no output: $OUTPUT"

DUR="unknown"
SIZE="unknown"
PROBE="$(command -v ffprobe || true)"
[ -z "$PROBE" ] && PROBE="${FFMPEG%ffmpeg}ffprobe"
if command -v "$PROBE" >/dev/null 2>&1 || [ -x "$PROBE" ]; then
  DUR="$("$PROBE" -v error -show_entries format=duration -of csv=p=0 "$OUTPUT" 2>/dev/null || echo unknown)"
fi
if command -v du >/dev/null 2>&1; then
  SIZE="$(du -h "$OUTPUT" | cut -f1)"
fi

ABS_OUT="$OUTPUT"
case "$ABS_OUT" in
  /*) ;;
  *)  ABS_OUT="$(pwd)/$OUTPUT" ;;
esac

printf '\n'
printf '\033[32m✓ lifecycle video ready\033[0m\n'
printf '  path:     %s\n' "$ABS_OUT"
printf '  duration: %s s\n' "$DUR"
printf '  size:     %s\n' "$SIZE"
