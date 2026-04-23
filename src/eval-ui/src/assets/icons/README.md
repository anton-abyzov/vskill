# Studio Icons

Monochrome line icons for the vSkill Studio UI. Designed to inherit theme color via `currentColor` — they render correctly in both light (warm off-white `#FBF8F3`) and dark (warm near-black `#1A1814`) themes without per-theme variants.

## Inventory

| File | Purpose | Usage |
|---|---|---|
| `update-available.svg` | Upward arrow + indicator dot — a skill has a newer remote version | `SkillRow` suffix glyph, `UpdateBell` badge |
| `update-bell.svg` | Notification bell with a small indicator dot on the top-right | `TopRail` right-side button; badge shows when >0 updates |
| `changelog.svg` | Document with revision marks | Version history panel, changelog preview links |
| `up-to-date.svg` | Check in a circle (calm, not celebratory) | Detail panel when `updateAvailable === false` |
| `install-pending.svg` | Download-into-tray | Install button on discover/catalog results (planned) |

## Conventions

- **24×24 viewBox, no width/height** so consumers can size via CSS (`width: 1em` typical).
- **`stroke="currentColor"`** — inherits `color` from the parent text element.
- **`stroke-width="1.75"`** — slightly heavier than Heroicons outline, matches the Inter Tight body weight.
- **Rounded caps + joins** — consistent with the warm-neutral aesthetic.
- **No fills** except deliberate solid dots (indicator markers).
- **`aria-hidden="true"`** — decorative; wrap in a button/link with text label for semantics.

## How to use

```tsx
import UpdateBell from "../assets/icons/update-bell.svg?react";

<button aria-label="3 updates available">
  <UpdateBell style={{ width: "1.125em", height: "1.125em" }} />
</button>
```

With Vite, `?react` turns the SVG into a component. Without that plugin, import as URL:

```tsx
import updateBellUrl from "../assets/icons/update-bell.svg";

<img src={updateBellUrl} alt="" aria-hidden style={{ color: "var(--text-primary)" }} />
```

## Size tokens

- Inline icon (row badges): 14–16px
- TopRail button: 18–20px
- Detail panel action button: 16px

The current set is sized for `1em`–`1.25em` display at 14–20px text sizes. Below 14px the `1.75` stroke gets heavy — use a lighter stroke if you need smaller.

## Changes

- 2026-04-23: initial set authored by hand for increment 0681 (update-notifications). Rationale: requested via Nano Banana, but raster output can't inherit `currentColor` and doesn't scale cleanly. Hand-written SVG is the right tool here; Nano Banana is reserved for illustrated / photographic assets.
