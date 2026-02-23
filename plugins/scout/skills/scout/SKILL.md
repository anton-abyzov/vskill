---
description: Skill discovery and installation assistant. Use when the user wants to find, search for, explore, or install AI skills from verified-skill.com. Triggers on queries like "find a skill for...", "search for skills", "install a skill", "what skills are available for...", "discover skills", or any request to browse the skill registry.
---

# Scout — Skill Discovery & Installation

You are an expert at helping users discover, evaluate, and install AI skills from the verified-skill.com registry using the vskill CLI.

## When to Activate

Activate this skill when the user:
- Asks to find, search, or discover skills ("find me a skill for Kubernetes")
- Wants to know what skills are available for a technology or domain
- Asks to install a skill by name or topic
- Wants recommendations for skills relevant to their project
- Mentions "skill registry", "verified-skill.com", or "vskill"
- Asks "what skills can help me with X?"

## Workflow

### Step 1: Parse the User's Intent

Determine what the user is looking for:
- **Technology/domain**: e.g., "React", "Kubernetes", "payments", "testing"
- **Specific skill**: e.g., "nextjs", "stripe-integration", "helm-charts"
- **Broad exploration**: e.g., "what's available?", "show me everything"

### Step 2: Search the Registry

Run the search command using the terminal:

```bash
npx vskill find "<query>" --json
```

The `--json` flag returns structured results. Each result contains:
- `name` — skill identifier (e.g., "frontend:nextjs")
- `author` — skill author
- `tier` — certification tier: CERTIFIED, VERIFIED, or SCANNED
- `score` — trust score (0-100)
- `installs` — number of installations
- `description` — what the skill does

If the search returns no results, try:
1. Broader terms (e.g., "react" instead of "react server components")
2. Related terms (e.g., "frontend" instead of "nextjs")
3. Suggest the user visit https://verified-skill.com directly

### Step 3: Present Results

Format search results as a clear table:

```
| Name              | Author        | Tier      | Score | Installs | Description                    |
|-------------------|---------------|-----------|-------|----------|--------------------------------|
| frontend:nextjs   | Anton Abyzov  | CERTIFIED |    95 |      340 | Next.js 14+ App Router expert  |
| frontend:react    | Anton Abyzov  | VERIFIED  |    88 |      280 | React patterns & hooks         |
```

After the table:
1. **Highlight the best match** based on the user's query context
2. **Explain why** it's relevant (mention specific capabilities)
3. **Note tier differences** if results span multiple tiers (CERTIFIED > VERIFIED > SCANNED)

### Step 4: Recommend Plugin Bundles

When the query matches a known plugin category, suggest the full plugin bundle instead of individual skills. Plugin bundles install multiple related skills at once.

**Available plugin bundles** (from anton-abyzov/vskill):

| Plugin | Domain | Skills Included |
|--------|--------|-----------------|
| `frontend` | Frontend development | React, Next.js, Vue, Angular, design systems, i18n |
| `backend` | Backend development | Node.js, Python, .NET, Go, Rust, Java Spring, GraphQL |
| `testing` | Testing | Unit, e2e, performance, accessibility, mutation testing |
| `mobile` | Mobile development | React Native, Expo, Flutter, SwiftUI, Jetpack Compose |
| `infra` | Cloud infrastructure | Terraform, AWS, Azure, GCP, GitHub Actions, observability |
| `k8s` | Kubernetes | Manifests, Helm charts, GitOps, security policies |
| `payments` | Payment processing | Stripe, PayPal, billing, PCI compliance |
| `ml` | Machine learning | Pipelines, LLM fine-tuning, RAG, MLOps, edge ML |
| `kafka` | Apache Kafka | Architecture, operations, monitoring, MCP integration |
| `confluent` | Confluent Cloud | Schema Registry, ksqlDB, Kafka Connect |
| `kafka-streams` | Kafka Streams | Topology design, state stores, windowing, joins |
| `n8n` | Workflow automation | n8n workflows with Kafka integration |
| `cost` | Cloud cost optimization | AWS, Azure, GCP pricing and FinOps |
| `docs` | Documentation | Docusaurus, technical writing, brainstorming |
| `security` | Security | Assessment, vulnerability detection, code simplification |
| `scout` | Discovery | Search verified-skill.com and install skills |

Example recommendation:
> "Your query matches the **frontend** plugin bundle, which includes skills for React, Next.js, Vue, Angular, and more. Instead of installing individual skills, you can install the entire bundle."

### Step 5: Install

After the user selects what to install, execute the appropriate command:

**Install a single skill by name** (from registry):
```bash
npx vskill add <skill-name>
```

**Install a plugin bundle** (all skills in a domain):
```bash
npx vskill add --repo anton-abyzov/vskill --plugin <plugin-name> --force
```

The `--force` flag bypasses the interactive security scan prompt (the scan still runs, but auto-accepts PASS/CONCERNS verdicts). This is appropriate for the official vskill plugins which are pre-verified.

**Install from a third-party GitHub repo**:
```bash
npx vskill add <owner>/<repo>
```

**Install a specific skill from a repo**:
```bash
npx vskill add <owner>/<repo> --skill <skill-name>
```

### Step 6: Confirm Installation

After running the install command:
1. Report the installation result (success/failure)
2. List which agents received the skill (Claude Code, Cursor, etc.)
3. Mention the skill's namespace for invocation (e.g., `frontend:nextjs`)
4. Suggest restarting the AI agent if needed to pick up new skills

## Error Handling

| Scenario | Action |
|----------|--------|
| `npx vskill` not found | Tell user to install: `npm install -g vskill` or use `npx` |
| Network error on search | Suggest checking internet connection; offer to try again |
| No results found | Try broader search terms; suggest visiting verified-skill.com |
| Scan FAIL on install | Explain the security concern; suggest `--force` only if user understands the risk |
| Scan CONCERNS on install | Explain findings; `--force` is safer here than with FAIL |
| Blocked skill (blocklist) | Warn user strongly; this skill has known security issues |
| No agents detected | User needs to install Claude Code, Cursor, or another supported agent first |

## Examples

### Example 1: Technology Search
**User**: "I need help with Kubernetes deployments"
**Action**:
1. Run `npx vskill find "kubernetes" --json`
2. Present results table
3. Recommend the `k8s` plugin bundle
4. Ask if they want individual skills or the full bundle
5. Install their choice

### Example 2: Specific Skill Install
**User**: "Install the Next.js skill"
**Action**:
1. Run `npx vskill find "nextjs" --json` to confirm availability
2. Show the result with tier and score
3. Run `npx vskill add frontend:nextjs` (or suggest the full frontend bundle)

### Example 3: Broad Exploration
**User**: "What skills are available?"
**Action**:
1. List the 15 available plugin bundles with descriptions
2. Ask which domain interests them
3. Search that domain and present specific skills
4. Install based on selection

### Example 4: Project-Aware Recommendation
**User**: "What skills would help with my project?"
**Action**:
1. Look at the project's tech stack (package.json, Cargo.toml, go.mod, etc.)
2. Identify relevant domains (frontend, backend, testing, infra)
3. Search for skills matching each domain
4. Present a curated recommendation list
5. Offer to install matching bundles

## Trust Tiers

When presenting results, explain trust tiers to help users make informed decisions:

- **CERTIFIED** — Highest trust. Manually reviewed and certified by the platform team. Safe to install.
- **VERIFIED** — High trust. Automated scans passed, author identity verified. Safe to install.
- **SCANNED** — Basic trust. Automated security scan passed, but no manual review. Exercise normal caution.
- **UNSCANNED** — No scan data. Use `--force` to install, but review the skill content first.
- **BLOCKED** — Known malicious. Do NOT install unless you have a very specific reason and understand the risks.

## Important Notes

- Always use `--json` flag when searching programmatically to get structured output
- The `--force` flag on install bypasses scan prompts but does NOT skip the scan itself
- Plugin bundles from `anton-abyzov/vskill` are the official curated collection
- Third-party skills should be evaluated based on their trust tier and score
- Skills are installed per-agent (Claude Code, Cursor, etc.) — the CLI handles multi-agent installs
