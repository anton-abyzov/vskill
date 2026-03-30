# Code Connect CLI Reference

Complete reference for `@figma/code-connect` CLI (v1.4.2+).

## Installation

```bash
npm install -D @figma/code-connect
# or globally
npm install -g @figma/code-connect
```

Requires: Node.js 18+, `FIGMA_ACCESS_TOKEN` env var with "Code Connect: Write" + "File content: Read" scopes.

## Commands

### `figma connect` (Interactive Setup)
```bash
npx figma connect [--token TOKEN]
```
Launches interactive wizard: scans repo → matches components → generates .figma.tsx files.
**Note**: Requires interactive input — not scriptable by AI agents. Use `figma connect create` instead.

### `figma connect create`
```bash
npx figma connect create <figma-node-url> [--token TOKEN] [-o outFile] [-o outDir]
```
Generates boilerplate `.figma.tsx` for a specific component URL. **Fully automatable**.

### `figma connect publish`
```bash
npx figma connect publish [--token TOKEN] [--dry-run] [--skip-validation] [-l label] [-b batch-size] [--exit-on-unreadable-files]
```
Publishes all Code Connect files to Figma. Snippets appear in Dev Mode.
- `--dry-run`: Validate without publishing
- `--exit-on-unreadable-files`: Exit non-zero on parse errors (recommended for CI)
- `-b batch-size`: Batch uploads for large datasets
- `-l label`: Filter by framework label

### `figma connect unpublish`
```bash
npx figma connect unpublish [--node URL] [-l label] [--token TOKEN]
```
Removes published mappings. **Warning**: omitting `--node` unpublishes ALL components.

### `figma connect parse`
```bash
npx figma connect parse [-l label] [--outFile file]
```
Parses and outputs JSON without publishing. Use for validation and debugging.

### `figma connect migrate` (Beta)
```bash
npx figma connect migrate [--outDir dir] [--javascript] [--typescript] [--include-props]
```
Migrates parser-based files to parserless template format.

## Global Flags

| Flag | Description |
|------|-------------|
| `-r, --dir <dir>` | Directory to parse (default: cwd) |
| `-t, --token <token>` | Figma access token |
| `-v, --verbose` | Verbose logging |
| `-c, --config <path>` | Path to figma.config.json |
| `--skip-update-check` | Skip CLI version check |

## figma.config.json

```json
{
  "codeConnect": {
    "parser": "react",
    "include": ["src/components/**"],
    "exclude": ["test/**", "docs/**"],
    "label": "React",
    "language": "typescript",
    "defaultBranch": "main",
    "documentUrlSubstitutions": {
      "https://figma.com/design/OLD_KEY/...": "https://figma.com/design/NEW_KEY/..."
    },
    "importPaths": {
      "src/components/*": "@ui/components"
    }
  }
}
```

### Parser options
`react` | `html` | `swift` | `compose` | `custom`

### Auto-detection
- `package.json` with `react` → react parser
- `package.json` without `react` → html parser
- `Package.swift` / `*.xcodeproj` → swift parser
- `build.gradle.kts` → compose parser

## Property Mapping API

### figma.connect()
```typescript
figma.connect(Component, "https://figma.com/...", {
  props: { /* property mappings */ },
  example: (props) => <Component {...props} />,
  variant: { Type: "Primary" },  // restrict to specific variant
  imports: ["import { Component } from '@lib'"]  // override imports
})
```

### Mapping Functions

| Function | Purpose | Example |
|----------|---------|---------|
| `figma.string(prop)` | Text properties | `figma.string("Label")` |
| `figma.boolean(prop, map?)` | Toggle properties | `figma.boolean("Disabled", { true: "disabled", false: undefined })` |
| `figma.enum(prop, map)` | Variant properties | `figma.enum("Size", { Small: "sm", Large: "lg" })` |
| `figma.instance(prop)` | Instance swap | `figma.instance("Icon")` |
| `figma.children(layer)` | Child instances | `figma.children("Tab")`, `figma.children("*")` |
| `figma.nestedProps(layer, map)` | Nested instance props | `figma.nestedProps("Shape", { size: figma.enum("Size", {...}) })` |
| `figma.textContent(layer)` | Text from child layer | `figma.textContent("Title")` |
| `figma.className(parts)` | Concatenated classes | `figma.className(["btn", figma.enum("Size", {...})])` |
| `figma.slot(name)` | Composable sub-areas (beta) | `figma.slot("Content")` |

### Advanced: Instance Methods
```typescript
// Access child props in parent
figma.instance("Prop").getProps<{iconId: string}>()

// Conditional rendering
figma.instance("Prop").render<PropsType>(props => <CustomIcon {...props} />)
```

### Variant Restrictions
```typescript
// Different code for different variants
figma.connect(PrimaryButton, url, {
  variant: { Type: "Primary" },
  example: () => <PrimaryButton />
})
figma.connect(DangerButton, url, {
  variant: { Type: "Danger", Disabled: true },
  example: () => <DangerButton />
})
```

## CI/CD: GitHub Actions

### Auto-publish on merge
```yaml
on:
  push:
    paths: [src/components/**/*.figma.tsx]
    branches: [main]
jobs:
  code-connect:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx figma connect publish --exit-on-unreadable-files
        env:
          FIGMA_ACCESS_TOKEN: ${{ secrets.FIGMA_ACCESS_TOKEN }}
```

### PR validation
```yaml
on:
  pull_request:
    paths: [src/components/**/*.figma.tsx]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx figma connect publish --dry-run --exit-on-unreadable-files
        env:
          FIGMA_ACCESS_TOKEN: ${{ secrets.FIGMA_ACCESS_TOKEN }}
```

## Key Constraints

- Code Connect files are NOT executed — ternaries/conditionals appear verbatim in output
- Only one connection type per component (UI vs CLI)
- Requires Organization/Enterprise plan for Code Connect features
- Custom parsers are in PREVIEW — API may change
