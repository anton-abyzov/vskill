# Studio keybindings

Single source-of-truth for the global keyboard shortcuts wired in `App.tsx`
through the `useKeyboardShortcut` hook (`src/eval-ui/src/hooks/useKeyboardShortcut.ts`).
**No component below `App.tsx` registers its own `keydown` listener for these
chords** — duplicate listeners caused two `setOpen(prev => !prev)` toggles to
fire on the same keystroke and the popovers cancelled each other out. Instead,
each chord dispatches a `CustomEvent` that the owning component listens for.

| Chord                  | Action                                               |
|------------------------|------------------------------------------------------|
| `Cmd+K` / `Ctrl+K`     | Open the **Find Skills** palette.                    |
| `Cmd+Shift+M` / `Ctrl+Shift+M` | Toggle the **Agent + Model** picker.         |
| `Cmd+B` / `Ctrl+B`     | Toggle skills sidebar.                               |
| `Cmd+Shift+D` / `Ctrl+Shift+D` | Toggle theme.                                |
| `Cmd+,` / `Ctrl+,`     | Open the **Preferences** window (0830).              |
| `Cmd+1..4` / `Ctrl+1..4` | Inside Preferences, switch tabs (General/Updates/Privacy/Advanced). |
| `?`                    | Open the keyboard cheatsheet modal.                  |
| `/`                    | Focus the sidebar search input.                      |
| `j` / `k`              | Move skill selection down / up in the sidebar.       |
| `Esc`                  | Close the topmost overlay (palette, picker, modal).  |

## Why `Cmd+Shift+M` for the picker

The Agent+Model picker originally bound itself to bare `Cmd+K`. So did the
Find Skills palette (the App-level shortcut). On the same keystroke both
popovers tried to open — the picker rendered on top, hiding the palette,
and users reported "Cmd+K opens the model selector, not Find Skills".

Moving the picker to `Cmd+Shift+M` (mnemonic: **M** for Model) leaves
`Cmd+K` exclusively for Find Skills, matching every other modern code-and-
content tool (VS Code, Linear, Notion, Slack quick switcher), and gives the
picker its own discoverable chord that doesn't collide with anything else
in the studio.

## Wiring pattern

App-level shortcuts dispatch a `CustomEvent` on `window`. Components that
own a popover listen for the matching event and toggle their own state.
This keeps keyboard wiring in one place (`App.tsx`) while letting components
remain reachable from anywhere (menu items, tours, programmatic calls)
without re-registering listeners.

| Event name              | Listener                       |
|-------------------------|--------------------------------|
| `openFindSkills`        | `FindSkillsPalette` shell      |
| `openAgentModelPicker`  | `AgentModelPicker` (toggles)   |
