# PARA Routing Rules

Determines where source files are routed after ingestion. The agent reads the file content and applies these rules to choose the destination folder.

---

## Decision Table

Evaluate rules top-to-bottom. First match wins.

| Content Signal | Destination | Rationale |
|---------------|-------------|-----------|
| Credential for an **active project** | `{{PROJECTS_FOLDER}}/<project>/` | Credentials live with the project that uses them |
| Credential for an **ongoing area/company** | `{{AREAS_FOLDER}}/<area>/` | Company creds stay with the company (e.g., Xero → EasyChamp) |
| Credential for **archived/past work** | `{{ARCHIVE_FOLDER}}/<topic>/` | Dead credentials live with dead projects |
| Credential with **no project/area match** | `{{CREDENTIALS_FOLDER}}/` | Generic catch-all for personal/orphan credentials |
| Active bounded initiative (has an endpoint) | `{{PROJECTS_FOLDER}}/<initiative>/` | Time-bound work with a deliverable |
| Ongoing responsibility (no endpoint) | `{{AREAS_FOLDER}}/<area>/` | Recurring, indefinite commitment |
| Reference material, technical knowledge | `{{RESOURCES_FOLDER}}/<category>/` | Not time-bound, lookup-oriented |
| Past/completed work | `{{ARCHIVE_FOLDER}}/<topic>/` | No longer active |

---

## Routing Signals

### Projects (active, has endpoint)
- Contract deliverables, SOWs, milestones
- Product launch plans with timelines
- Migration or upgrade initiatives
- Job applications, interview prep
- Event-specific planning

### Areas (ongoing, no endpoint)
- Business operations (own company)
- Family and personal logistics
- Finance and tax records
- Fitness and sports tracking
- Recurring professional development

### Resources (reference, not time-bound)
- Technical documentation and tutorials
- Professional network contacts
- Credential and secret storage
- Industry knowledge and best practices
- Tool configurations and setup guides

### Archive (completed/inactive)
- Past contractors and their deliverables
- Completed projects
- Legacy system documentation
- Superseded plans and strategies

---

## Subfolder Rules

1. **Company-specific files** go in the company's subfolder, not in generic categories
   - e.g., company reports → `{{AREAS_FOLDER}}/<CompanyName>/`, not `{{RESOURCES_FOLDER}}/reports/`
2. **Bounded initiatives** within an ongoing area get their own Project subfolder
   - e.g., "v2 Migration" for an ongoing business → `{{PROJECTS_FOLDER}}/<CompanyName>/`
3. **No duplicate folders** within the same PARA category
   - Check existing subfolders before creating a new one
4. **Past collaborators** → `{{ARCHIVE_FOLDER}}/` (not Projects or Areas)

---

## Ambiguity Resolution

When content matches multiple categories:
1. **Credentials skip wiki** -- never create a wiki page for credentials, but route to the RIGHT folder (project > area > archive > generic)
2. **Project context first** -- scan for project/area signals in the filename and content before defaulting to the generic credentials folder
3. **Active > reference** -- if content is being worked on, it's a Project or Area
4. **Specific > generic** -- company-specific beats general category (EasyChamp Xero key → EasyChamp folder, not generic credentials)
5. **Ask when truly ambiguous** -- if two categories are equally valid, ask the user
