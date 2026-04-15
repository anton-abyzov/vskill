# Wiki Page Format

Standards for wiki pages created and maintained by the LLM in `{{WIKI_DIR}}/`.

---

## Frontmatter

YAML frontmatter at the top of each wiki page. Required fields: `type` and `title`. Additional fields are optional -- add them when useful, not as ceremony.

```yaml
---
type: entity | concept | source | synthesis | map
title: "Page Title"
---
```

### Optional Fields

```yaml
---
type: entity
title: "Page Title"
aliases: ["Alt Name", "Abbreviation"]
tags: [tag1, tag2]
related: ["[[other-page]]", "[[another-page]]"]
created: YYYY-MM-DD
updated: YYYY-MM-DD
source: "[[YYYY-MM-DD-source-slug]]"
---
```

---

## Page Types

### Entity
A person, company, product, place, or distinct named thing.

```yaml
---
type: entity
title: "Acme Corp"
---
```

Body structure: summary paragraph, key facts, relationships to other entities, timeline of interactions.

### Concept
An idea, pattern, methodology, technique, or abstract topic.

```yaml
---
type: concept
title: "PARA Method"
---
```

Body structure: definition, key principles, examples, relationships to other concepts.

### Source
Summary of ingested material (article, document, export, note).

```yaml
---
type: source
title: "Article: How to Build a Second Brain"
---
```

Naming: `YYYY-MM-DD-slug.md` (date prefix for chronological sorting).
Body structure: source metadata (author, URL, date), key takeaways, quotes, connections to existing wiki pages.

### Synthesis
Cross-cutting analysis, comparison, or insight derived from multiple sources.

```yaml
---
type: synthesis
title: "Comparison: Note-Taking Methods"
---
```

Body structure: thesis/question, analysis drawing from multiple pages (cited via wikilinks), conclusion.

### Map
Visual or structural overview of a domain or relationship set.

```yaml
---
type: map
title: "Professional Network Map"
---
```

Body structure: hierarchical or grouped listing of related pages, optionally with Mermaid diagrams.

---

## Naming Conventions

| Rule | Example |
|------|---------|
| Lowercase, hyphens, no spaces | `acme-corp.md` |
| Max 60 characters | `comparison-note-taking-methods.md` |
| Sources get date prefix | `2026-04-14-how-to-build-second-brain.md` |
| Synthesis pages | `synthesis-note-taking-comparison.md` |
| Maps subfolder (optional) | `maps/professional-network.md` |

### Slugification Rules
1. Lowercase everything
2. Replace spaces and underscores with hyphens
3. Remove special characters except hyphens
4. Collapse multiple hyphens into one
5. Trim leading/trailing hyphens
6. Truncate to 60 characters at a word boundary

---

## Wikilinks

Use `[[filename]]` without folder paths. Obsidian resolves links regardless of file location.

```markdown
Related: [[acme-corp]], [[para-method]], [[2026-04-14-article-slug]]
```

### Cross-Reference Rules
- Every new page should link to 2-5 existing related pages
- When updating a page, add backlinks from related pages to the new one
- Use inline wikilinks in running text, not just a "Related" section
- Log every new cross-reference: `YYYY-MM-DD HH:MM | @link | page-a -> page-b | reason`

---

## Page Size Limit

Wiki pages must stay under 1500 lines. If content exceeds this:

1. Split into multiple pages with `(part N)` suffix
   - `long-topic.md` → `long-topic-part-1.md`, `long-topic-part-2.md`
2. Add navigation cross-references between parts
3. Create an index/overview page if 3+ parts exist
4. Update `{{INDEX_FILE}}` with all part entries

---

## Non-ASCII Filenames

Preserve original language in filenames when the source is in a non-Latin script. Slugify within the script:
- Russian: `заметки-о-проекте.md` (lowercase Cyrillic, hyphens)
- Mixed: use the dominant language for the slug
