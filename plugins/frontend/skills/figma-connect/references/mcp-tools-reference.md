# Figma MCP Tools Reference

Complete API reference for all Figma MCP server tools available via `mcp__claude_ai_Figma__*`.

## Design Reading Tools

### get_design_context (Flagship)
**Purpose**: Extract design context for a Figma node — primary tool for design-to-code.
**Params**: `fileKey` (required), `nodeId` (required), `clientFrameworks`, `clientLanguages`, `disableCodeConnect`, `excludeScreenshot`, `forceCode`
**Returns**: Reference code (default React+Tailwind), screenshot, asset download URLs, Code Connect snippets if configured.
**Notes**: Output varies by Figma setup — may include Code Connect snippets, component docs, design annotations, design tokens as CSS variables, or raw values.

### get_screenshot
**Purpose**: Capture pixel-accurate screenshot of a Figma node.
**Params**: `fileKey` (required), `nodeId` (required)
**Returns**: Image of the node.

### get_metadata
**Purpose**: Sparse XML representation of layer hierarchy (IDs, types, names, positions, sizes).
**Params**: `fileKey` (required), `nodeId` (required), `clientFrameworks`, `clientLanguages`
**Returns**: XML hierarchy data. No styling or code — use for decomposing large frames before calling get_design_context on specific nodes.
**Note**: Always prefer get_design_context. Never call for Figma Make files.

### get_variable_defs
**Purpose**: Extract design token definitions (colors, spacing, typography) from a node.
**Params**: `fileKey` (required), `nodeId` (required), `clientFrameworks`, `clientLanguages`
**Returns**: Variable name-to-value mappings (e.g., `{"icon/default/secondary": "#949494"}`).
**Note**: Returns variables used by the specific node, not the entire file.

## Code Connect Tools

### get_code_connect_map
**Purpose**: Read existing Code Connect mappings for a node.
**Params**: `fileKey` (required), `nodeId` (required), `codeConnectLabel` (optional — filter by framework)
**Returns**: `{[nodeId]: {codeConnectSrc: "path", codeConnectName: "ComponentName"}}`

### add_code_connect_map
**Purpose**: Create a single Code Connect mapping.
**Params**: `fileKey` (required), `nodeId` (required), `source` (required), `componentName` (required), `label` (required — one of 16 framework labels), `template` (optional), `templateDataJson` (optional), `clientFrameworks`, `clientLanguages`
**Labels**: React, Web Components, Vue, Svelte, Storybook, Javascript, Swift, Swift UIKit, Objective-C UIKit, SwiftUI, Compose, Java, Kotlin, Android XML Layout, Flutter, Markdown
**Note**: Creates simple component_browser mapping by default. Provide `template` for figmadoc-type record with richer mappings. Rate-limit exempt.

### get_code_connect_suggestions
**Purpose**: AI-suggested strategy for linking Figma components to code components.
**Params**: `fileKey` (required), `nodeId` (required), `clientFrameworks`, `clientLanguages`
**Returns**: List of unmapped components with names, properties, thumbnails.
**Requires**: Organization/Enterprise plan with published team library components.
**Workflow**: Call this → review with user → call send_code_connect_mappings.

### send_code_connect_mappings
**Purpose**: Bulk-save multiple Code Connect mappings.
**Params**: `fileKey` (required), `nodeId` (required), `mappings` (array of mapping objects)
**Mapping object**: `{nodeId, componentName, source, label, template?, templateDataJson?}`

## Design System Tools

### search_design_system
**Purpose**: Search connected design libraries for components, variables, and styles.
**Params**: `query` (required), `fileKey` (required), `includeComponents`, `includeVariables`, `includeStyles`, `includeLibraryKeys` (filter to specific libraries)

### create_design_system_rules
**Purpose**: Generate a rules file encoding design system conventions for consistent code output.
**Params**: `clientFrameworks` (optional), `clientLanguages` (optional)

## Write Tools

### use_figma
**Purpose**: Execute JavaScript via Figma Plugin API to create/modify Figma content.
**Params**: `fileKey` (required), `code` (JS string, max 50k chars, required), `description` (required)
**Note**: Beta — currently free, will become usage-based. Requires edit access.

### create_new_file
**Purpose**: Create a blank Figma Design or FigJam file in user's drafts.
**Params**: `fileName` (required), `planKey` (required — from whoami), `editorType` ("design" or "figjam")

## FigJam Tools

### get_figjam
**Purpose**: Read FigJam board content as XML with node images.
**Params**: `fileKey` (required), `nodeId` (required), `includeImagesOfNodes` (default: true)
**Note**: FigJam files ONLY.

### generate_diagram
**Purpose**: Create FigJam diagrams from Mermaid.js syntax.
**Params**: `name` (required), `mermaidSyntax` (required), `userIntent` (optional)
**Supported**: graph, flowchart, sequenceDiagram, stateDiagram, gantt. NOT: class diagrams, timelines, Venn, ER.

## Utility Tools

### whoami
**Purpose**: Returns authenticated user identity, email, plan memberships, seat type.
**Params**: None
**Note**: Rate-limit exempt.

## Rate Limits

Rate limits vary by plan. Check [Figma developer documentation](https://www.figma.com/developers/api) for current limits. Batch operations to reduce API calls.

**Exempt tools**: add_code_connect_map, whoami
