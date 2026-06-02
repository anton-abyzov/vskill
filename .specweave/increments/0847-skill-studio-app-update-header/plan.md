---
increment: 0847-skill-studio-app-update-header
---

# Plan: Skill Studio Header App Update Button

1. Extract whole-app updater state from `AppUpdateToast` into a shared React provider/hook.
2. Keep the existing toast as the detailed secondary surface.
3. Add a top-rail slot and mount a compact `AppUpdateButton` beside update notifications.
4. Wire the button to download, install, then restart through the existing `useDesktopBridge` methods.
5. Add focused Vitest coverage and run the eval UI build.
