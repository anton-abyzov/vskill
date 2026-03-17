---
description: "This skill should be used when the user asks to \"post in Chrome\", \"automate Chrome\", \"open Chrome and post\", \"submit a post via browser\", \"use Chrome to publish\", or \"automate browser posting\". Activate whenever the user mentions posting content through Chrome, browser automation with AppleScript, or needs to interact with web UI elements that require clicking buttons in Chrome. Also triggers on \"Chrome AppleScript\", \"browser automation mac\", \"click button in Chrome\"."
allowed-tools: Bash, Read, Write, Edit
---

# /chrome-post-automator

Automate posting content through Google Chrome on macOS, using AppleScript for UI interaction and JavaScript execution when standard DOM clicks fail.

Execute each step immediately. Run Bash commands directly — do not ask for permission or describe plans.

## Workflow

### Step 1 — Determine the target. Run this immediately:

Ask the user for:
- The URL to navigate to (e.g., social media platform, CMS, forum)
- The content to post (text, and optionally image paths)
- Which account/profile if relevant

If the user already provided these details, skip asking and proceed.

### Step 2 — Open Chrome and navigate. Run this immediately:

```bash
osascript -e '
tell application "Google Chrome"
    activate
    if (count of windows) = 0 then
        make new window
    end if
    set URL of active tab of front window to "TARGET_URL_HERE"
end tell
'
```

Replace `TARGET_URL_HERE` with the actual URL.

### Step 3 — Wait for page load. Run this immediately:

```bash
osascript -e '
tell application "Google Chrome"
    set maxWait to 30
    set waited to 0
    repeat while waited < maxWait
        set pageState to execute active tab of front window javascript "document.readyState"
        if pageState is "complete" then exit repeat
        delay 1
        set waited to waited + 1
    end repeat
end tell
'
```

### Step 4 — Interact with the page via JavaScript injection. Run this immediately:

Use Chrome's `execute javascript` to find and interact with elements:

```bash
osascript -e '
tell application "Google Chrome"
    execute active tab of front window javascript "
        // Example: click a compose/new post button
        const btn = document.querySelector(\"[aria-label=\\\"New post\\\"]\");
        if (btn) btn.click();
    "
end tell
'
```

Adapt selectors to the target platform. Common strategies:
- `querySelector('[aria-label="..."]')` for accessible buttons
- `querySelector('[data-testid="..."]')` for React/test-id based UIs
- `querySelector('button')` combined with text content filtering
- `document.querySelectorAll('div[role="button"]')` for div-based buttons

### Step 5 — Type content into text fields. Run this immediately:

```bash
osascript -e '
tell application "Google Chrome"
    execute active tab of front window javascript "
        const editor = document.querySelector(\"[contenteditable=\\\"true\\\"]\") || document.querySelector(\"textarea\");
        if (editor) {
            editor.focus();
            document.execCommand(\"insertText\", false, \"POST_CONTENT_HERE\");
        }
    "
end tell
'
```

Replace `POST_CONTENT_HERE` with the actual post content (properly escaped for shell + JS).

### Step 6 — AppleScript UI fallback for stubborn buttons. Run this immediately when JS click fails:

Some platforms use shadow DOM, iframes, or heavy event listeners that block programmatic clicks. Fall back to AppleScript System Events for pixel-level interaction:

```bash
osascript -e '
tell application "Google Chrome" to activate
delay 0.5
tell application "System Events"
    tell process "Google Chrome"
        -- Option A: keyboard shortcut if available
        keystroke "return" using {command down}
        
        -- Option B: click at coordinates (use Step 7 to find them)
        -- click at {x, y} of front window
    end tell
end tell
'
```

**Keystroke approach** is preferred over coordinate clicking because it survives window repositioning.

Common keyboard shortcuts by platform:
- `keystroke "return" using {command down}` — submit/post on many platforms
- `keystroke tab` then `keystroke return` — tab to submit button then press it
- `key code 36` — raw Return key

### Step 7 — Discover element positions when needed. Run this immediately:

When coordinate clicking is required, inject JS to find the button's position:

```bash
osascript -e '
tell application "Google Chrome"
    set result to execute active tab of front window javascript "
        const btn = document.querySelector(\"[aria-label=\\\"Post\\\"]\");
        if (btn) {
            const r = btn.getBoundingClientRect();
            JSON.stringify({x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2 + 80)});
        } else { \"not found\"; }
    "
end tell
'
```

The `+80` offset accounts for Chrome's toolbar height. Adjust based on actual Chrome UI.

### Step 8 — Upload images if needed. Run this immediately:

For file upload dialogs, use System Events to interact with the native file picker:

```bash
osascript -e '
tell application "System Events"
    tell process "Google Chrome"
        -- After clicking upload button, wait for dialog
        delay 2
        keystroke "g" using {command down, shift down}
        delay 1
        keystroke "/path/to/image.png"
        delay 0.5
        keystroke return
        delay 1
        -- Click "Open" or "Upload" button
        click button "Open" of sheet 1 of front window
    end tell
end tell
'
```

### Step 9 — Verify the post was submitted. Run this immediately:

```bash
osascript -e '
tell application "Google Chrome"
    set pageContent to execute active tab of front window javascript "document.body.innerText.substring(0, 500)"
end tell
return pageContent
'
```

Check for success indicators (confirmation message, redirect, toast notification).

## Rules

- **JS-first, AppleScript-fallback**: Always attempt JavaScript DOM interaction before resorting to System Events UI scripting — JS is more reliable across window positions and screen resolutions.
- **Escape carefully**: Content flows through three layers (bash → AppleScript → JavaScript). Each layer needs its own escaping. Use single quotes for bash, backslash-escaped quotes for AppleScript strings, and double-backslash-escaped quotes for JS inside AppleScript.
- **Wait for transitions**: Add `delay 1` or `delay 2` between actions that trigger page transitions or modal dialogs. Platforms with SPAs need time to render.
- **Accessibility permissions**: System Events requires Accessibility access for the terminal app. If clicks fail silently, remind the user to grant access in System Preferences → Privacy & Security → Accessibility.
- **Never store credentials**: Do not type passwords or tokens via this automation. Rely on existing browser sessions.
- **Platform adaptation**: Each website has different selectors and flows. Inspect the page first by dumping key selectors before attempting automation.

## Debugging

If an interaction fails:
1. Dump the current page HTML selectors to identify the right element
2. Check if the element is inside an iframe (requires switching context)
3. Check if the element is in shadow DOM (requires `shadowRoot` traversal)
4. Try `dispatchEvent(new MouseEvent('click', {bubbles: true}))` instead of `.click()`
5. Fall back to AppleScript System Events keystroke or coordinate click
