---
name: obsidian-brain
description: "Autonomous Obsidian vault management using the PARA + LLM Wiki pattern. Three operations: ingest (inbox to wiki + PARA routing), query (cross-vault synthesis), lint (health check). Scheduled via CronCreate 4x/day. Filesystem-only -- no Obsidian app dependency. Activate when the user mentions 'ingest', 'vault', 'wiki page', 'obsidian brain', 'vault lint', 'inbox', 'wiki index', 'knowledge base query', or wants to process, organize, query, or audit their Obsidian vault."
  - Read
  - Write
  - Glob
  - Grep
  - Bash
  - CronCreate
metadata:
  version: 1.1.0
  tags: obsidian, vault, wiki, knowledge-management, para, llm-wiki, ingest, lint, cron
---

# Obsidian Brain

Autonomous vault management skill implementing the Karpathy LLM Wiki pattern. Teaches the agent to manage an Obsidian vault as a folder of markdown files using three operations: **ingest**, **query**, and **lint**.

The vault has three layers:
1. **PARA folders** (user-owned) -- organized by actionability
2. **Wiki** (LLM-owned) -- synthesis layer with entities, concepts, sources, maps
3. **Inbox** (drop zone) -- new sources awaiting ingestion

This skill operates entirely via filesystem tools. No Obsidian app, CLI, or Sync dependency.

---

## Configuration

All paths are user-configured. Replace placeholders before first use.

```yaml
vault_path: "{{VAULT_PATH}}"              # Absolute path to Obsidian vault root
para_folders:
  projects: "{{PROJECTS_FOLDER}}"          # e.g. "001 Projects"
  areas: "{{AREAS_FOLDER}}"                # e.g. "002 Areas"
  resources: "{{RESOURCES_FOLDER}}"        # e.g. "003 Resources"
  archive: "{{ARCHIVE_FOLDER}}"            # e.g. "004 Archive"
wiki_dir: "{{WIKI_DIR}}"                   # e.g. "wiki"
inbox_dir: "{{INBOX_DIR}}"                 # e.g. "raw/inbox"
log_file: "{{LOG_FILE}}"                   # e.g. "wiki/log.md"
index_file: "{{INDEX_FILE}}"              # e.g. "wiki/index.md"
credentials_folder: "{{CREDENTIALS_FOLDER}}" # e.g. "003 Resources/credentials"
```

**Resolved paths**: All operations resolve relative paths against `vault_path`. For example, `inbox_dir` resolves to `{{VAULT_PATH}}/{{INBOX_DIR}}/`.

---

## Operations

This skill supports three operations, each described below. For scheduled autonomous execution, see [Scheduled Operation](#scheduled-operation).

---

### 1. Ingest

Processes new files from the inbox into wiki pages and routes originals to PARA folders.

**Trigger**: Files present in `{{VAULT_PATH}}/{{INBOX_DIR}}/`.

#### Credential Guard (MANDATORY -- runs first)

Before processing any file, scan its content for sensitive material:

```
Patterns (case-insensitive):
  password\s*[:=]
  api[_-]?key\s*[:=]
  secret[_-]?key\s*[:=]
  token\s*[:=]
  aws_access_key_id\s*[:=]
  aws_secret_access_key\s*[:=]
  AKIA[0-9A-Z]{16}
  private[_-]?key\s*[:=]
  bearer\s+[a-zA-Z0-9\-._~+/]+=*
```

**On credential match**: STOP wiki ingestion for that file (never create a wiki page from credentials).

1. **Discover vault structure** — list subfolders across all PARA categories to understand what domains exist (see [references/routing-rules.md](references/routing-rules.md) Step 1)
2. **Identify domain** — analyze filename + content for domain signals (company names, project names, service types, technology keywords). Match against existing vault folders.
3. **Route by domain context** (see [references/routing-rules.md](references/routing-rules.md) Step 3 for the full decision tree):
   - **Domain match** → route to domain's folder (company, project, or area)
   - **Service match** → route to the service's tech subfolder in Resources
   - **Personal account** → route to typed subfolder in `{{CREDENTIALS_FOLDER}}/` (Email-Accounts/, Social-Media/, Cloud-Providers/, etc.)
   - **Unknown** → `{{CREDENTIALS_FOLDER}}/` root (last resort only)
4. Log: `YYYY-MM-DD HH:MM | !cred | <filename> | credential detected, routed to <destination>`
5. **Never** create a wiki page from credential content
6. Continue processing remaining inbox files

#### Ingest Procedure

**Before processing any files**, scan the vault structure to build a routing map:
- List subfolders in `{{PROJECTS_FOLDER}}/`, `{{AREAS_FOLDER}}/`, `{{RESOURCES_FOLDER}}/`, `{{ARCHIVE_FOLDER}}/`
- This tells you what domains exist, which are active vs archived, and prevents creating duplicate folders

For each non-credential file in the inbox:

1. **Read** the source file (never modify it in place)
2. **Identify domain first** — what domain does this content belong to? Match against existing vault folders by company name, project name, technology, service. Then determine PARA category (Project vs Area vs Resource vs Archive).
   - See [references/routing-rules.md](references/routing-rules.md) for the full domain recognition and routing table
3. **Create wiki page** in `{{VAULT_PATH}}/{{WIKI_DIR}}/`:
   - Filename: `slugified-name.md` (lowercase, hyphens, max 60 chars)
   - Sources get date prefix: `YYYY-MM-DD-slug.md`
   - Frontmatter: see [references/wiki-format.md](references/wiki-format.md)
   - Add `[[wikilinks]]` to related existing pages
   - Cap at 1500 lines; if longer, split into parts with `(part N)` suffix and cross-references
4. **Update related pages**: add cross-references (`[[new-page]]`) to existing wiki pages that share topics
5. **Update index**: append the new page entry to `{{VAULT_PATH}}/{{INDEX_FILE}}`
   - Format: `- [[page-name]] -- one-line summary`
6. **Log** all mutations to `{{VAULT_PATH}}/{{LOG_FILE}}`:
   - New page: `YYYY-MM-DD HH:MM | +page | page-name | created from <source>`
   - Updated page: `YYYY-MM-DD HH:MM | ~page | page-name | added cross-ref to <new-page>`
   - Ingest event: `YYYY-MM-DD HH:MM | >ingest | <source> | N pages created/updated`
   - New link: `YYYY-MM-DD HH:MM | @link | page-a -> page-b | bidirectional cross-ref`
7. **Route original** file to the correct PARA folder per routing rules
   - Use `Bash` to move: the source file is read-only during ingest, then moved (not copied)

A single source should touch 5-15 wiki pages. The wiki compounds with every ingest.

---

### 2. Query

Synthesizes answers from across the vault, with source citations via wikilinks.

**Trigger**: User asks a question about vault contents.

**Tools used**: Read, Glob, Grep only. No Obsidian app or CLI dependency.

#### Query Procedure

1. **Read index** at `{{VAULT_PATH}}/{{INDEX_FILE}}` to identify candidate pages
2. **Search** for additional relevant pages using Grep across `{{VAULT_PATH}}/{{WIKI_DIR}}/` and PARA folders
3. **Read** the most relevant pages (typically 3-10 depending on query scope)
4. **Synthesize** an answer that:
   - Cites sources with `[[wikilinks]]` (by filename, no folder path)
   - Distinguishes facts from inference
   - Notes contradictions between pages if any exist
5. **Optionally file as wiki page**: if the synthesis produces a novel comparison or insight:
   - Create `{{VAULT_PATH}}/{{WIKI_DIR}}/synthesis-slug.md` with frontmatter `type: synthesis`
   - Add cross-references to source pages
   - Update `{{INDEX_FILE}}` with the new synthesis page
   - Log: `YYYY-MM-DD HH:MM | ?query | synthesis-slug | query: "<summary of question>"`
6. **Log the query** even if no page is filed:
   - `YYYY-MM-DD HH:MM | ?query | - | query: "<summary of question>", N pages consulted`

---

### 3. Lint

Periodic health check that catches organizational issues before they compound.

**Trigger**: Manual request, or scheduled run when threshold/cadence is met.

#### Deterministic Checks (via script)

Run `scripts/lint-check.sh` with `Bash`:

```bash
bash scripts/lint-check.sh "{{VAULT_PATH}}" "{{WIKI_DIR}}" "{{INDEX_FILE}}" "{{INBOX_DIR}}" 10
```

The script checks:
- **Orphan pages**: wiki pages not listed in `{{INDEX_FILE}}`
- **Inbox backlog**: file count in `{{INBOX_DIR}}` vs threshold (default: 10)
- **Missing cross-refs**: wiki pages mentioned in `[[wikilinks]]` but not existing as files

#### Semantic Checks (via LLM analysis)

After running the script, perform LLM-driven analysis on flagged pages:
- **Contradictions**: read pairs of related pages and flag conflicting information
- **Stale information**: identify pages with outdated dates, deprecated references, or superseded content
- **Missing concept pages**: scan for recurring terms across pages that lack their own wiki entry

#### Lint Report

Categorize findings by severity:

| Severity | Meaning | Examples |
|----------|---------|---------|
| **error** | Broken structure, must fix | Orphan page, missing wikilink target |
| **warning** | Quality issue, should fix | Inbox backlog > threshold, stale content |
| **info** | Suggestion, nice to fix | Missing concept page, potential cross-ref |

Each finding includes an actionable fix suggestion (e.g., "Add `[[page-name]]` to index.md").

#### Logging

Log the lint run summary:
- `YYYY-MM-DD HH:MM | !lint | - | E errors, W warnings, I info findings`

Log individual error-severity findings:
- `YYYY-MM-DD HH:MM | !lint | <page> | <finding description>`

---

### Scheduled Operation

Autonomous 4x/day execution via CronCreate. See [references/cron-setup.md](references/cron-setup.md) for full configuration.

#### CronCreate Setup

```
CronCreate({
  schedule: "0 8,12,16,20 * * *",
  prompt: "Run obsidian-brain scheduled maintenance on vault at {{VAULT_PATH}}",
  description: "Obsidian Brain: scheduled vault maintenance (ingest, lint, index)"
})
```

Adjust the cron expression to match your timezone and preferred schedule.

#### Pre-flight Checks (every scheduled run)

Before executing any operation, verify:

1. **Vault accessible**: `test -d "{{VAULT_PATH}}/{{WIKI_DIR}}"` -- abort with `!error` log if fails
2. **Inbox count**: `ls "{{VAULT_PATH}}/{{INBOX_DIR}}/" | wc -l` -- determines whether ingest runs
3. **Last-run timestamp**: read the last line of `{{LOG_FILE}}` -- skip if last run was < 2 hours ago to prevent duplicate processing

If pre-flight fails:
- `YYYY-MM-DD HH:MM | !error | - | pre-flight failed: <reason>`
- Abort the run (do not proceed to operations)

#### Run Priority

Each scheduled run executes operations in this order:

1. **Ingest** -- if inbox has files, run the full ingest procedure
2. **Lint** -- if inbox backlog exceeds threshold OR last lint was > 7 days ago
3. **Index rebuild** -- run `scripts/update-index.sh` to regenerate `{{INDEX_FILE}}`

#### Run Logging

Every scheduled run logs start and completion:
- Start: `YYYY-MM-DD HH:MM | >ingest | - | scheduled run started`
- End: `YYYY-MM-DD HH:MM | >ingest | - | scheduled run complete: N ingested, L lint findings, index rebuilt`
- Error: `YYYY-MM-DD HH:MM | !error | - | <error description>`

No silent failures -- every run produces at least a start + completion/error log entry.

---

## Constraints

1. **Never modify source files** during ingest -- wiki is the synthesis, sources are the truth
2. **Preserve non-ASCII filenames** (including Cyrillic, CJK, etc.)
3. **No credentials in wiki/** -- always route to the configured credentials folder
4. **Wiki page size limit**: 1500 lines max. Split with `(part N)` suffix if exceeded
5. **Log every wiki mutation** -- no write to wiki/ without a corresponding log entry
6. **Index must be plain text** -- links + one-line summaries, no Dataview queries
7. **No git operations** on the vault -- Obsidian Sync handles synchronization
8. **No Obsidian app dependency** -- all operations use filesystem tools only

---

## Reference Files

Detailed documentation for each subsystem (loaded on demand):

- [references/vault-schema.md](references/vault-schema.md) -- 3-layer architecture (PARA + wiki + inbox)
- [references/routing-rules.md](references/routing-rules.md) -- PARA routing decision table
- [references/wiki-format.md](references/wiki-format.md) -- frontmatter types, naming, linking conventions
- [references/cron-setup.md](references/cron-setup.md) -- CronCreate schedule + pre-flight configuration

## Scripts

Shell scripts for deterministic operations (POSIX-compatible):

- [scripts/detect-changes.sh](scripts/detect-changes.sh) -- inbox file count + recently modified files
- [scripts/update-index.sh](scripts/update-index.sh) -- regenerate index from wiki page frontmatter
- [scripts/lint-check.sh](scripts/lint-check.sh) -- orphan detection, missing cross-refs, backlog count
