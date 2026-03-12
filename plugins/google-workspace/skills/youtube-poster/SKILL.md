---
description: "This skill should be used when the user asks to 'post to YouTube', 'create a YouTube post', 'upload a video to YouTube', 'open YouTube Studio', 'create a YouTube community post', or 'automate YouTube posting'. Activate whenever the user mentions posting content to YouTube, launching Chrome with their personal profile for YouTube, or using AppleScript to interact with YouTube Studio."
allowed-tools: Bash, Read, Write
---

# /youtube-poster

Automates YouTube content posting on macOS by launching Chrome with the correct personal profile and navigating to YouTube Studio. Uses AppleScript for UI automation when browser commands alone are insufficient.

**Execute each step immediately. Run Bash commands directly — do not ask for permission or describe plans. Provide complete, ready-to-run code for every action.**

## Execution

**Step 1 — Discover Chrome profiles. Run this immediately:**

```bash
ls ~/Library/Application\ Support/Google/Chrome/ | grep -E "^(Default|Profile [0-9]+)$"
```

Then read display names:

```bash
for dir in ~/Library/Application\ Support/Google/Chrome/Default ~/Library/Application\ Support/Google/Chrome/Profile\ */; do
  [ -f "${dir}/Preferences" ] || continue
  name=$(python3 -c "import json; d=json.load(open('${dir}/Preferences')); print(d.get('profile',{}).get('name','unknown'))" 2>/dev/null)
  echo "$(basename \"$dir\"): $name"
done
```

If multiple profiles exist and the target is ambiguous, ask the user which to use. Otherwise pick the one matching their request.

**Step 2 — Launch Chrome with the correct profile. Run immediately:**

```bash
open -a "Google Chrome" "https://studio.youtube.com" --args --profile-directory="Default"
```

For named profiles replace `Default` with `Profile 1`, `Profile 2`, etc.

If Chrome is already open, reuse the existing window:

```applescript
tell application "Google Chrome"
    activate
    set URL of active tab of window 1 to "https://studio.youtube.com"
end tell
```

**Step 3 — Determine post type** (ask if not specified):

| Type | URL | Notes |
|------|-----|-------|
| Video upload | `https://studio.youtube.com/` | Click CREATE → Upload videos |
| Community post | `https://studio.youtube.com/community` | Text, image, or poll |
| Shorts | Same as video upload | Video under 60 seconds |
| Scheduled post | Video upload flow | Choose Schedule instead of Publish |

**Step 4 — Navigate and post. Provide complete code immediately:**

For a **community post**, run:

```applescript
tell application "Google Chrome"
    activate
    set URL of active tab of window 1 to "https://studio.youtube.com/community"
    repeat until (loading of active tab of window 1) is false
        delay 0.5
    end repeat
end tell
```

Then inject the post text and submit. Replace `POST_TEXT_HERE` with the actual text:

```applescript
tell application "Google Chrome"
    execute active tab of window 1 javascript "
        var box = document.querySelector('div[contenteditable]');
        if (box) { box.focus(); box.innerText = 'POST_TEXT_HERE'; }
    "
end tell
```

For a **video upload**, first check the file exists, then open Chrome and handle the file picker:

```bash
[ -f ~/Desktop/tutorial.mp4 ] && echo "File exists" || echo "File NOT found"
```

```bash
open -a "Google Chrome" "https://studio.youtube.com" --args --profile-directory="Default"
```

After the upload dialog opens, pass the file path:

```applescript
tell application "System Events"
    keystroke "g" using {command down, shift down}
    delay 0.8
    keystroke "/Users/username/Desktop/tutorial.mp4"
    key code 36
end tell
```

Ask the user for video **title and description** before completing the upload, or use these if already provided:
- Title: [user's title]
- Description: [user's description]

**Step 5 — Confirm success. Run immediately:**

```applescript
tell application "Google Chrome"
    set pageTitle to execute active tab of window 1 javascript "document.title"
end tell
```

Report the page title and URL to confirm correct state.

## AppleScript Patterns

### Execute JavaScript in Active Tab

```applescript
tell application "Google Chrome"
    set result to execute active tab of window 1 javascript "document.querySelector('#create-icon') !== null"
end tell
```

### Click Element via JavaScript

```applescript
tell application "Google Chrome"
    execute active tab of window 1 javascript "document.querySelector('button[aria-label=\'CREATE\']').click()"
end tell
```

### Check Page Load State

```applescript
tell application "Google Chrome"
    repeat until (loading of active tab of window 1) is false
        delay 0.5
    end repeat
end tell
```

### Quit Chrome Before Relaunching with Different Profile

```bash
osascript -e 'tell application "Google Chrome" to quit'
sleep 1
open -a "Google Chrome" "https://studio.youtube.com" --args --profile-directory="Profile 2"
```

## Rules

- Always discover profiles dynamically before opening Chrome — never assume `Default` is the personal profile
- If Chrome is already open with the correct profile, navigate within the existing window rather than opening a duplicate
- Add `delay 0.5` to `delay 1.5` between AppleScript UI steps to allow Chrome's UI to respond
- Before video uploads, verify the file path exists: `[ -f "/path/to/video.mp4" ] && echo exists`
- `System Events` AppleScript requires Accessibility permission — if denied, prompt the user: System Settings → Privacy & Security → Accessibility → add the terminal app
- Prefer JavaScript execution via `execute ... javascript` over `System Events` key/click simulation when YouTube Studio elements are addressable via DOM
- For scheduled posts, confirm the target publish time with the user before setting it

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Wrong account showing | List all profiles, relaunch with correct `--profile-directory` |
| AppleScript permission denied | Grant Accessibility access to Terminal/iTerm in System Settings |
| Chrome ignores profile flag | Quit Chrome fully first, then relaunch |
| File picker not responding | Use `System Events` keystroke approach with adequate delays |
| Upload button unclickable | Page still loading — wait with `repeat until loading is false` loop |
| Community post box not found | YouTube Studio may have updated DOM selectors — inspect and update the query selector |
