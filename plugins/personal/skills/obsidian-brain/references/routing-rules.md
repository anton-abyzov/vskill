# PARA Routing Rules

Determines where source files are routed after ingestion. The agent reads the file content and applies these rules to choose the destination folder.

---

## Step 1: Discover the Vault (BEFORE routing)

Before routing any file, the agent MUST scan the vault to build a mental map of existing structure. This prevents creating duplicates and ensures files land where related content already lives.

```
1. List all subfolders in {{PROJECTS_FOLDER}}/, {{AREAS_FOLDER}}/, {{RESOURCES_FOLDER}}/, {{ARCHIVE_FOLDER}}/
2. Note which domains are active (Projects/Areas) vs archived
3. Use this map for every routing decision — match content to EXISTING folders first
```

---

## Step 2: Domain Recognition

The agent identifies the DOMAIN a file belongs to by analyzing its filename, content, and keywords. Domains cut across PARA — the same domain (e.g., EasyChamp) can have folders in Projects, Areas, AND Resources.

### Domain Keyword Map

The agent builds this dynamically from the vault scan, but common patterns:

| Domain | Keyword Signals | Typical Locations |
|--------|----------------|-------------------|
| **EasyChamp** | easychamp, wc-26, futbol cracks, keycloak, tournament | Areas/EasyChamp Business Operations/, Projects/ for bounded initiatives |
| **Open Source** | specweave, vskill, anymodel, verified-skill, vskill-platform | Projects/Specweave + Vskill/, Projects/Anymodel/ |
| **Career** | resume, interview, job, immigration, EB-1A, visa, portfolio | Projects/Career Development/ |
| **Active Contractors** | colibri, auxo, olympus + contractor names | Projects/Contractor Work/<contractor>/ |
| **AI/ML Tech** | gemini, nano banana, claude, openai, ollama, huggingface, seedance, veo | Resources/Technical Knowledge/AI-ML-Technologies/ or EasyChamp/AI-ML-Tools/ |
| **Cloud/DevOps** | aws, gcp, azure, cloudflare, terraform, docker, k8s | Resources/Technical Knowledge/Cloud-Services/ |
| **YouTube** | youtube, video, channel, analytics, content creation | Projects/YouTuber/ |
| **Finance** | tax, invoice, payment, bank, xero, payroll, contractor payment | Areas/Finance & Legal/ or Areas/Contractor Work Management/ |
| **Sports/Fitness** | crossfit, futsal, gym, training, workout | Areas/Sports & Fitness/ |
| **Past Contractors** | itransition, softgreat, carnival, sportchamp, sportradar, latoken, skywize | Archive/Contractors/<name>/ |

### Domain vs PARA Decision

Once the domain is identified, determine the PARA category:

```
Domain identified
    │
    ├── Is this bounded work with a deadline/deliverable?
    │   YES → Projects (even if the domain also has an Areas folder)
    │
    ├── Is this ongoing responsibility with no endpoint?
    │   YES → Areas
    │
    ├── Is this reference/lookup material not tied to current work?
    │   YES → Resources
    │
    └── Is this about something completed/inactive?
        YES → Archive
```

---

## Step 3: Credential Routing (when credential detected)

Credentials NEVER get wiki pages. But they DO get routed intelligently:

```
Credential detected
    │
    ├── 1. Domain match? → Route to domain's folder
    │      (Xero key + "EasyChamp" → Areas/EasyChamp Business Operations/)
    │      (Cloudflare secret + "anymodel" → Projects/Anymodel/)
    │      (Stripe key + "career" → Projects/Career Development/)
    │
    ├── 2. Service match? → Route to the service's tech folder
    │      (AWS key, no project context → Resources/Technical Knowledge/Cloud-Services/)
    │      (Huggingface token → Resources/Technical Knowledge/AI-ML-Technologies/)
    │      (GitHub PAT → Resources/Technical Knowledge/Developer-Tools/)
    │
    ├── 3. Personal account? → Credentials catch-all by service type
    │      (Personal Gmail → Credentials/Email-Accounts/)
    │      (Spotify → Credentials/Social-Media/)
    │      (WiFi password → Credentials/Personal-WiFi-Passwords/)
    │
    └── 4. Unknown → {{CREDENTIALS_FOLDER}}/ root (last resort)
```

**Key insight**: The credential catch-all at `{{CREDENTIALS_FOLDER}}/` already has typed subfolders (AI-ML-Services, Cloud-Providers, Social-Media, Banking-Financial, Payment-Services, Developer-Tools, Software-Licenses, etc.). Even "generic" credentials should land in the right subfolder, not the root.

---

## Step 4: Non-Credential Routing

### Decision Table (first match wins)

| Content Signal | Destination | Rationale |
|---------------|-------------|-----------|
| **Company-specific content** (any company name detected) | Company's own folder in Projects or Areas | Company content stays together |
| **Active contractor deliverable** (Colibri, Auxo, Olympus) | `{{PROJECTS_FOLDER}}/Contractor Work/<name>/` | Active contractors are projects |
| **Past contractor content** (Itransition, Softgreat, etc.) | `{{ARCHIVE_FOLDER}}/Contractors/<name>/` | Dead work stays archived |
| **Bounded initiative with deadline** | `{{PROJECTS_FOLDER}}/<initiative>/` | Time-bound work |
| **Ongoing area responsibility** | `{{AREAS_FOLDER}}/<area>/` | Indefinite commitment |
| **Technology reference/tutorial** | `{{RESOURCES_FOLDER}}/Technical Knowledge/<category>/` | Lookup material |
| **Professional contact/network** | `{{RESOURCES_FOLDER}}/Professional Network/` | People references |
| **Business knowledge/strategy** | `{{RESOURCES_FOLDER}}/Business Knowledge/` | Industry knowledge |
| **Personal/lifestyle** | `{{RESOURCES_FOLDER}}/Personal Life/` or relevant Area | Personal reference |
| **Completed/inactive** | `{{ARCHIVE_FOLDER}}/<topic>/` | No longer active |

---

## Subfolder Rules

1. **Company-specific files** go in the company's subfolder, not in generic categories
   - e.g., EasyChamp Google Analytics → `Areas/EasyChamp Business Operations/`, NOT `Resources/Technical Knowledge/`
2. **Tech used BY a company** goes with the company if it's company-specific config
   - e.g., EasyChamp Keycloak setup → `Areas/EasyChamp Business Operations/`
   - e.g., General Keycloak tutorial → `Resources/Technical Knowledge/`
3. **Bounded initiatives** within an ongoing area get their own Project subfolder
   - e.g., "HYPE Accelerator" for EasyChamp → `Projects/` or `Areas/EasyChamp/Accelerators-Programs/`
4. **No duplicate folders** — always check existing subfolders before creating new ones
5. **Past collaborators** → `{{ARCHIVE_FOLDER}}/` (not Projects or Areas)
6. **AI/ML tools used by EasyChamp** → `Areas/EasyChamp/AI-ML-Tools/` (not generic AI-ML)

---

## Ambiguity Resolution

When content matches multiple categories:
1. **Credentials skip wiki** — never create a wiki page, but route to the smartest folder
2. **Domain first** — identify the domain before choosing the PARA category
3. **Existing folder wins** — if a matching folder already exists, use it (don't create parallel structure)
4. **Active > reference** — if content is being worked on, it's a Project or Area
5. **Specific > generic** — company-specific beats general category
6. **Tech context matters** — "Google Gemini for EasyChamp" → EasyChamp, "Google Gemini tutorial" → Resources
7. **Ask when truly ambiguous** — if two categories are equally valid, ask the user
