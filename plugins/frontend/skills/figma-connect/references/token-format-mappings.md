# Token Format Mappings

Maps Figma variable definitions (from `get_variable_defs` MCP tool) to project token formats.

## Figma Variable Structure

Figma variables are organized in collections (e.g., "Colors", "Spacing") with optional modes (e.g., "Light", "Dark"). The `get_variable_defs` tool returns flat name-value pairs:

```json
{
  "color/primary": "#3B82F6",
  "color/secondary": "#64748B",
  "color/background": "#FFFFFF",
  "spacing/xs": "4px",
  "spacing/sm": "8px",
  "spacing/md": "16px",
  "font/size/body": "16px",
  "font/size/heading": "24px",
  "border/radius/sm": "4px"
}
```

## Format: CSS Custom Properties

**Detect**: `*.css` token files or no specific format found (default).

```css
:root {
  /* Colors */
  --color-primary: #3B82F6;
  --color-secondary: #64748B;
  --color-background: #FFFFFF;

  /* Spacing */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;

  /* Typography */
  --font-size-body: 16px;
  --font-size-heading: 24px;

  /* Border */
  --border-radius-sm: 4px;
}

/* Dark mode (if Figma has mode variants) */
[data-theme="dark"] {
  --color-primary: #60A5FA;
  --color-background: #1E293B;
}
```

**Naming convention**: Replace `/` with `-` in Figma variable names.

## Format: Tailwind CSS

**Detect**: `tailwind.config.{js,ts,mjs}` exists.

```typescript
// tailwind.config.ts
import type { Config } from 'tailwindcss'

const config: Config = {
  theme: {
    extend: {
      colors: {
        primary: '#3B82F6',
        secondary: '#64748B',
        background: '#FFFFFF',
      },
      spacing: {
        xs: '4px',
        sm: '8px',
        md: '16px',
      },
      fontSize: {
        body: '16px',
        heading: '24px',
      },
      borderRadius: {
        sm: '4px',
      },
    },
  },
}

export default config
```

**Naming convention**: Strip category prefix (e.g., `color/primary` → `primary`), use camelCase for multi-word keys.

## Format: Style Dictionary

**Detect**: `style-dictionary.config.json` or `tokens.json` with Style Dictionary structure.

```json
{
  "color": {
    "primary": { "value": "#3B82F6", "type": "color" },
    "secondary": { "value": "#64748B", "type": "color" },
    "background": { "value": "#FFFFFF", "type": "color" }
  },
  "spacing": {
    "xs": { "value": "4px", "type": "dimension" },
    "sm": { "value": "8px", "type": "dimension" },
    "md": { "value": "16px", "type": "dimension" }
  },
  "font": {
    "size": {
      "body": { "value": "16px", "type": "dimension" },
      "heading": { "value": "24px", "type": "dimension" }
    }
  }
}
```

**Naming convention**: Figma `/` separators become nested JSON keys.

## Format: Swift (iOS)

**Detect**: `*.xcodeproj` or `Package.swift`.

```swift
import SwiftUI

extension Color {
    static let primary = Color(hex: "#3B82F6")
    static let secondary = Color(hex: "#64748B")
    static let background = Color(hex: "#FFFFFF")
}

enum Spacing: CGFloat {
    case xs = 4
    case sm = 8
    case md = 16
}

enum FontSize: CGFloat {
    case body = 16
    case heading = 24
}
```

## Format: Kotlin (Android/Compose)

**Detect**: `build.gradle.kts` with Compose.

```kotlin
object DesignTokens {
    object Colors {
        val Primary = Color(0xFF3B82F6)
        val Secondary = Color(0xFF64748B)
        val Background = Color(0xFFFFFFFF)
    }

    object Spacing {
        val Xs = 4.dp
        val Sm = 8.dp
        val Md = 16.dp
    }

    object FontSize {
        val Body = 16.sp
        val Heading = 24.sp
    }
}
```

## Category Detection

Map Figma variable name prefixes to token categories:

| Prefix Pattern | Category | CSS Group |
|---------------|----------|-----------|
| `color/*`, `fill/*`, `bg/*` | Colors | `/* Colors */` |
| `spacing/*`, `space/*`, `gap/*` | Spacing | `/* Spacing */` |
| `font/*`, `text/*`, `typography/*` | Typography | `/* Typography */` |
| `border/*`, `radius/*`, `corner/*` | Borders | `/* Borders */` |
| `shadow/*`, `elevation/*` | Shadows | `/* Shadows */` |
| `opacity/*`, `alpha/*` | Opacity | `/* Opacity */` |
| `size/*`, `width/*`, `height/*` | Sizing | `/* Sizing */` |
| `breakpoint/*`, `screen/*` | Breakpoints | `/* Breakpoints */` |

## Theme/Mode Handling

If Figma variables have multiple modes (Light/Dark):

1. **CSS**: Use `[data-theme="dark"]` or `@media (prefers-color-scheme: dark)`
2. **Tailwind**: Use `darkMode: 'class'` with `.dark` prefix
3. **Style Dictionary**: Separate token files per mode (`tokens.light.json`, `tokens.dark.json`)
4. **Swift**: Use `Color(light:dark:)` or asset catalog
5. **Kotlin**: Use `MaterialTheme` with `lightColorScheme`/`darkColorScheme`
