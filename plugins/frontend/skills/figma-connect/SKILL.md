---
name: figma-connect
description: "Figma-to-code bridge combining Figma MCP server tools with the Code Connect CLI for end-to-end design implementation workflows. Use this skill when implementing UI components from Figma design URLs, publishing Code Connect mappings to Figma Dev Mode, extracting design tokens from Figma variables, setting up Figma Code Connect in a project, or running the full design-to-code roundtrip pipeline. Activate when the user shares a Figma design URL and wants code implementation, says 'implement from Figma', 'code connect', 'publish to dev mode', 'figma connect publish', 'extract design tokens from Figma', 'figma to code', 'connect components to Figma', 'set up code connect', 'sync figma tokens', 'figma variables to CSS', 'figma variables to Tailwind', 'map component to Figma', 'npx figma connect', or references any figma.com/design URL in a code implementation context. Do NOT activate for pure Figma file creation, FigJam diagrams, Figma plugin development, or Storybook setup — those are separate concerns."
metadata:
  version: 1.0.3
  tags: figma, code-connect, design-to-code, design-tokens, dev-mode, mcp, react, vue, swiftui, compose, frontend
---

# Figma Connect

Bridge between Figma MCP server (reads designs, generates code, extracts tokens) and Code Connect CLI (publishes persistent component mappings to Dev Mode). Use MCP tools for READ operations, CLI for PUBLISH operations.

## Prerequisites & Dual Auth

This skill requires two independent authentication paths:

**MCP Auth (OAuth)** — for all `mcp__claude_ai_Figma__*` tools:
1. Call `whoami()` to check. If it fails, the user needs to authenticate the Figma MCP server via their MCP client settings (OAuth flow).
2. Requires Full or Dev seat on a paid Figma plan.

**CLI Auth (Token)** — for `npx figma connect publish/parse/create`:
1. Check: `[ -n "$FIGMA_ACCESS_TOKEN" ] && echo "Token set" || echo "Token missing"` or `npx figma connect --version`
2. If missing: create a personal access token at figma.com/developers with scopes "Code Connect: Write" and "File content: Read"
3. Set via: `export FIGMA_ACCESS_TOKEN=<token>` (prefer `.env` with `.gitignore` entry to avoid shell history exposure)

**Always check both** before workflows that use both (Setup, Publish, Roundtrip). Design-to-Code and Token Extraction only need MCP auth.

## Framework Detection

Auto-detect the project framework to set MCP `clientFrameworks` param and CLI Code Connect label:

| Detection Signal | Framework | Code Connect Label | `clientFrameworks` |
|-----------------|-----------|-------------------|-------------------|
| `package.json` has `react` | React | `React` | `react` |
| `package.json` has `next` | React (Next.js) | `React` | `react,nextjs` |
| `package.json` has `vue` | Vue | `Vue` | `vue` |
| `package.json` has `svelte` | Svelte | `Svelte` | `svelte` |
| `package.json` has `@angular/core` | Angular | `Web Components` | `angular` |
| `Podfile` or `*.xcodeproj` + SwiftUI | SwiftUI | `SwiftUI` | `swiftui` |
| `build.gradle.kts` + Compose | Compose | `Compose` | `compose` |
| `pubspec.yaml` has `flutter` | Flutter | `Flutter` | `flutter` |
| None detected / plain HTML | Web Components | `Web Components` | `html,css` |

**Precedence**: User-stated framework in the prompt always overrides file detection. When ambiguous (e.g., monorepo with multiple frameworks), ask the user.

## URL Parsing

Extract `fileKey` and `nodeId` from Figma URLs before calling MCP tools:

```
Standard:  figma.com/design/:fileKey/:fileName?node-id=:nodeId
           -> fileKey = :fileKey, nodeId = convert "-" to ":" in :nodeId

Branch:    figma.com/design/:fileKey/branch/:branchKey/:fileName
           -> fileKey = :branchKey (NOT :fileKey), nodeId from query param

Make:      figma.com/make/:makeFileKey/:makeFileName
           -> fileKey = :makeFileKey
```

Always convert `node-id` dashes to colons: `42-156` becomes `42:156`.

---

## Mode 1: Setup

**When**: New project, first-time Code Connect configuration.

### Steps

1. **Check MCP auth**: Call `whoami()`. If fails, guide OAuth setup and stop.

2. **Check CLI auth**: Run `npx figma connect --version`. If not found, install:
   ```bash
   npm install -D @figma/code-connect
   ```
   Then check `FIGMA_ACCESS_TOKEN` is set.

3. **Detect framework**: Inspect project files (see Framework Detection table above).

4. **Generate config**: Create `figma.config.json` at project root:
   ```json
   {
     "codeConnect": {
       "parser": "react",
       "include": ["src/components/**"],
       "exclude": ["**/*.test.*", "**/*.stories.*"],
       "label": "React"
     }
   }
   ```
   Adjust `parser`, `include`, and `label` based on detected framework.

5. **Generate design system rules** (optional but recommended):
   Call MCP `create_design_system_rules()` with `clientFrameworks` and `clientLanguages`.
   Save the output to a rules file in the project (e.g., `.cursor/rules/figma-design-system.md` or `.claude/rules/`).

6. **Extract initial tokens** (optional):
   If a Figma URL was provided, call `get_variable_defs(fileKey, nodeId)` and write tokens to the project's token file format (see Mode 4).

### Output
- `@figma/code-connect` installed
- `figma.config.json` created
- Design system rules file saved
- Both auth paths verified

---

## Mode 2: Design-to-Code

**When**: User shares a Figma URL and wants code implementation. (For new projects needing full setup first, run Mode 1 before this.)

### Steps

1. **Check MCP auth**: Call `whoami()`. If it fails, guide OAuth setup and stop.

2. **Parse URL**: Extract `fileKey` and `nodeId` (see URL Parsing section).

3. **Screenshot** (visual confirmation):
   Call `get_screenshot(fileKey, nodeId)` to see what we're implementing.

4. **Check existing Code Connect**:
   Call `get_code_connect_map(fileKey, nodeId)` to check whether mappings exist. Note: `get_design_context` independently includes `<CodeConnectSnippet>` wrappers when mappings are present — prioritize these over generated code.

5. **Get design context**:
   ```
   get_design_context(
     fileKey, nodeId,
     clientFrameworks: "<detected-framework>",
     clientLanguages: "<detected-languages>"
   )
   ```
   Returns: reference code (default React+Tailwind), screenshot, asset download URLs.

6. **Adapt to project conventions**:
   - Replace hardcoded colors/spacing with project tokens (CSS vars, Tailwind classes)
   - Use existing project components instead of generating duplicates
   - Follow project file naming and directory conventions
   - Import from project's component library, not generated imports
   - If Code Connect snippets were returned, use them as the primary implementation reference

7. **Download assets**: Use the asset URLs from `get_design_context` response for images, icons, etc.

8. **Suggest Code Connect** (if not set up):
   If `get_code_connect_map` returned empty, suggest: "Consider setting up Code Connect to improve future design-to-code workflows. Run the Setup mode to get started."

### MCP Tools Used
- `get_screenshot(fileKey, nodeId)` — visual reference
- `get_code_connect_map(fileKey, nodeId)` — check existing mappings
- `get_design_context(fileKey, nodeId, clientFrameworks, clientLanguages)` — generate code
- `get_variable_defs(fileKey, nodeId)` — extract tokens (optional, if needed for styling)
- `search_design_system(query, fileKey)` — find reusable design system components (optional)

---

## Mode 3: Code Connect Publish

**When**: User wants to map existing code components back to Figma so they appear in Dev Mode.

### Prerequisites
- Both MCP and CLI auth verified
- `@figma/code-connect` installed
- `figma.config.json` exists (or will be created)

### Steps

1. **Get AI suggestions**:
   Call `get_code_connect_suggestions(fileKey, nodeId, clientFrameworks, clientLanguages)`.
   Returns: list of unmapped components with names, properties, thumbnails.
   Requires Organization/Enterprise plan with published team library components.

2. **Analyze code components**: Read the source files for components that match suggestions. Understand their props, variants, and structure.

3. **Choose mapping approach**:

   **Simple mappings** (no variants/props): Use MCP directly:
   ```
   send_code_connect_mappings(fileKey, nodeId, mappings: [
     { nodeId: "5:30", componentName: "Button", source: "src/components/Button.tsx", label: "React" }
   ])
   ```

   **Complex mappings** (variants, boolean props, enums): Generate a `.figma.tsx` file:
   ```tsx
   import figma from "@figma/code-connect"
   import { Button } from "./Button"

   figma.connect(Button, "https://figma.com/design/abc123/DS?node-id=5-30", {
     props: {
       label: figma.string("Label"),
       disabled: figma.boolean("Disabled"),
       variant: figma.enum("Variant", {
         Primary: "primary",
         Secondary: "secondary",
         Danger: "danger"
       }),
       icon: figma.instance("Icon")
     },
     example: (props) => (
       <Button variant={props.variant} disabled={props.disabled} icon={props.icon}>
         {props.label}
       </Button>
     )
   })
   ```

4. **Validate** before publishing:
   ```bash
   npx figma connect parse --label React
   ```
   Fix any parse errors before proceeding.

5. **Publish** (or dry-run):
   ```bash
   # Dry-run first (recommended)
   npx figma connect publish --dry-run

   # Actual publish
   npx figma connect publish
   ```

6. **Verify**: Call `get_code_connect_map(fileKey, nodeId)` to confirm the mapping is registered. Future `get_design_context` calls will now include Code Connect snippets.

### Property Mapping Functions
| Function | Maps | Example |
|----------|------|---------|
| `figma.string(prop)` | Text properties | `figma.string("Label")` |
| `figma.boolean(prop, map?)` | Toggle properties | `figma.boolean("Disabled")` |
| `figma.enum(prop, map)` | Variant properties | `figma.enum("Size", { Small: "sm", Large: "lg" })` |
| `figma.instance(prop)` | Instance swap (nested component) | `figma.instance("Icon")` |
| `figma.children(layer)` | Child instances by layer name | `figma.children("Tab")` |
| `figma.textContent(layer)` | Text from child layers | `figma.textContent("Title")` |
| `figma.className(parts)` | Concatenated class names | `figma.className(["btn", figma.enum("Size", {...})])` |

See `references/code-connect-cli-reference.md` for full API documentation.

---

## Mode 4: Token Extraction

**When**: User wants to sync Figma design variables to code token files.

### Steps

1. **Extract variables**:
   ```
   get_variable_defs(fileKey, nodeId, clientFrameworks, clientLanguages)
   ```
   Returns: variable name-to-value mappings (e.g., `{"color/primary": "#3B82F6", "spacing/md": "16px"}`).

2. **Detect project token format**:
   - `tailwind.config.{js,ts}` exists → Tailwind theme format
   - `tokens/` or `src/tokens/` directory with `.css` → CSS custom properties
   - `style-dictionary.config.json` → Style Dictionary format
   - None found → ask user or default to CSS custom properties

3. **Map and organize**: Group by category (colors, spacing, typography, shadows, etc.) based on Figma variable collection/group naming.

4. **Write token files**:

   **CSS Custom Properties**:
   ```css
   :root {
     /* Colors */
     --color-primary: #3B82F6;
     --color-secondary: #64748B;

     /* Spacing */
     --spacing-sm: 8px;
     --spacing-md: 16px;
     --spacing-lg: 24px;
   }
   ```

   **Tailwind Config**:
   ```typescript
   // Add to tailwind.config.ts theme.extend
   colors: {
     primary: '#3B82F6',
     secondary: '#64748B',
   },
   spacing: {
     sm: '8px',
     md: '16px',
     lg: '24px',
   }
   ```

See `references/token-format-mappings.md` for all supported formats.

---

## Mode 5: Roundtrip

**When**: Full end-to-end setup — new project or design system migration.

### Flow
1. **Setup** (Mode 1): Auth, framework, CLI, config, design system rules
2. **Token Extraction** (Mode 4): Pull Figma variables into project token files
3. **Design-to-Code** (Mode 2): Implement key components from the design system
4. **Code Connect Publish** (Mode 3): Map implemented components back to Figma
5. **Verify**: Call `get_design_context` again with the same fileKey/nodeId. When Code Connect mappings are registered, the response includes Code Connect snippet wrappers (typically tagged similar to `<CodeConnectSnippet>`) containing the component import and usage — look for these as the confirmation signal. If absent, re-run `npx figma connect publish` and retry.

### When to Use
- Greenfield project connecting to an existing Figma design system
- Migrating a design system from another tool to Figma Code Connect
- Auditing and fixing Code Connect coverage across a component library

---

## MCP vs CLI Decision Tree

| Task | Tool | Why |
|------|------|-----|
| Read design / generate code | MCP `get_design_context` | MCP returns structured context for LLM |
| Get visual reference | MCP `get_screenshot` | Built-in screenshot capability |
| Check existing mappings | MCP `get_code_connect_map` | Read-only operation |
| Get mapping suggestions | MCP `get_code_connect_suggestions` | AI-powered matching |
| Create simple mappings | MCP `send_code_connect_mappings` | No prop mapping needed |
| Create complex mappings | Generate `.figma.tsx` manually + CLI `figma connect parse` | Rich prop mapping API |
| Validate before publish | CLI `figma connect parse` | Local validation |
| Publish to Dev Mode | CLI `figma connect publish` | Only way to make snippets visible |
| Dry-run validation | CLI `figma connect publish --dry-run` | Pre-flight check |
| Extract design tokens | MCP `get_variable_defs` | Direct variable access |
| Search design system | MCP `search_design_system` | Cross-library search |
| Generate design rules | MCP `create_design_system_rules` | Convention template |
| CI/CD automation | CLI in GitHub Actions | Headless operation |

---

## Error Handling

| Error | Cause | Resolution |
|-------|-------|------------|
| `whoami` fails / no user data | MCP not authenticated | Re-authenticate Figma MCP server via client settings (OAuth) |
| `FIGMA_ACCESS_TOKEN` not set | CLI not authenticated | Create token at figma.com/developers, set env var |
| `npx figma connect` not found | CLI not installed | `npm install -D @figma/code-connect` |
| `figma connect parse` errors | Invalid .figma.tsx syntax | Check Code Connect template syntax, ensure correct imports |
| `figma connect publish` 403 | Token lacks "Code Connect: Write" scope | Regenerate token with correct scopes |
| `get_code_connect_suggestions` empty | No published library components | Publish components to team library first |
| Rate limit (429) | Too many MCP calls | Rate limits vary by plan — check Figma developer documentation for current limits. Batch operations to reduce API calls. |
| Node not found | Invalid nodeId or file moved | Verify URL, check if file was renamed or node deleted |
| Branch URL wrong fileKey | Using fileKey instead of branchKey | For branch URLs, use branchKey as fileKey (see URL Parsing) |
| Code Connect conflict | UI and CLI mappings on same node | Only one connection type per component. Remove one before adding the other. |
