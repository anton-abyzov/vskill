# Vault Schema: 3-Layer Architecture

The vault uses a three-layer architecture combining the PARA method with an LLM-generated wiki layer.

---

## Layer 1: PARA Folders (User-Owned)

Organized by actionability. The user creates and edits these directly.

```
{{VAULT_PATH}}/
├── {{PROJECTS_FOLDER}}/    # Active work with endpoints
├── {{AREAS_FOLDER}}/       # Ongoing responsibilities
├── {{RESOURCES_FOLDER}}/   # Reference materials
└── {{ARCHIVE_FOLDER}}/     # Completed/inactive
```

| Folder | Purpose | Examples |
|--------|---------|---------|
| **Projects** | Active work with a defined endpoint | Contract work, product launches, migrations |
| **Areas** | Ongoing responsibilities with no endpoint | Business operations, family, finance, sports |
| **Resources** | Reference material, not time-bound | Technical knowledge, credentials, professional network |
| **Archive** | Completed or inactive items | Past contractors, legacy notes, finished projects |

### Key Rules
- A file belongs to exactly one PARA folder at any time
- Projects have endpoints (they complete); Areas do not
- When a project completes, move its folder to Archive
- Bounded initiatives within an Area get their own Project subfolder
- Company-specific files go in the company's folder, not in generic categories

---

## Layer 2: Wiki (LLM-Owned)

The synthesis layer. The LLM owns this entirely -- it creates, updates, and maintains wiki pages.

```
{{VAULT_PATH}}/{{WIKI_DIR}}/
├── index.md       # Plain-text catalog of all wiki pages
├── log.md         # Append-only activity log
├── overview.md    # What this knowledge base contains
└── [pages]        # Entities, concepts, sources, synthesis, maps
```

### Wiki Page Types

| Type | Purpose | Naming |
|------|---------|--------|
| `entity` | Person, company, product, place | `slugified-name.md` |
| `concept` | Idea, pattern, methodology | `slugified-name.md` |
| `source` | Summary of ingested material | `YYYY-MM-DD-slug.md` |
| `synthesis` | Cross-cutting analysis or comparison | `synthesis-slug.md` |
| `map` | Visual/structural overview of a domain | `map-slug.md` or `maps/slug.md` |

### index.md

Plain-text catalog. Each entry is one line:
```
- [[page-name]] -- one-line summary
```

No Dataview queries as primary content. The index must be readable without Obsidian.

### log.md

Append-only activity log. Format:
```
YYYY-MM-DD HH:MM | PREFIX | page | details
```

Prefixes: `+page` (created), `~page` (updated), `>ingest` (ingest event), `?query` (query), `!lint` (lint finding), `!cred` (credential detected), `!error` (error), `@link` (cross-ref added), `-page` (removed)

---

## Layer 3: Inbox (Drop Zone)

```
{{VAULT_PATH}}/{{INBOX_DIR}}/
└── [new files awaiting ingestion]
```

Users drop new articles, notes, exports, and raw material here. The LLM processes them via the ingest operation, then moves originals to the correct PARA folder.

### Other Vault Directories

```
{{VAULT_PATH}}/
├── assets/        # Images, Excalidraw, attachments (not managed by this skill)
└── CLAUDE.md      # Vault schema and operational instructions
```

---

## Relationships Between Layers

```
Inbox (raw material)
  │
  ▼  [ingest]
Wiki (synthesis) ◄──► PARA (organized originals)
  │                      │
  ▼  [query]             ▼  [routing]
Answers + new           Correct folder
synthesis pages         per routing rules
```

- **Ingest** moves files from Inbox → PARA and creates wiki synthesis
- **Query** reads from Wiki + PARA to produce answers
- **Lint** checks Wiki health and Inbox backlog
- **PARA routing** determines where originals land after ingest
