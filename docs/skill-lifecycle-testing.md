# Verified Skill: Lifecycle, Versioning & Testing Guide

## Skill: obsidian-brain v1.1.0

**Source**: `plugins/personal/skills/obsidian-brain/`
**Registry**: `verified-skill.com`
**SHA**: `c3a47760617096e80722273a7952c55dc4d12da04734d83cdf584879b2fce9fc`

---

## Version Lifecycle

### Where Versions Live

| Location | Purpose | Example |
|----------|---------|---------|
| `SKILL.md` frontmatter (`metadata.version`) | Authoritative source | `version: 1.1.0` |
| `vskill.lock` (`skills.<name>.version`) | Local install record | `"version": "1.1.0"` |
| verified-skill.com DB (`SkillVersion`) | Registry of published versions | Version history with SHA |

### Version Resolution Priority

```
1. Registry version (from verified-skill.com API)
   ↓ fallback
2. SKILL.md frontmatter (metadata.version)
   ↓ fallback
3. Auto-patch bump (SHA changed → increment patch)
   ↓ fallback
4. Default: 1.0.0
```

### Semver Rules

| Change | Bump | Example |
|--------|------|---------|
| Bugfix, typo, wording | Patch | 1.1.0 → 1.1.1 |
| New operation, new feature | Minor | 1.1.0 → 1.2.0 |
| Breaking change (renamed config, removed operation) | Major | 1.1.0 → 2.0.0 |

---

## Full Lifecycle Procedure

### 1. DEVELOP (local edit)

```bash
cd repositories/anton-abyzov/vskill
# Edit skill files
vim plugins/personal/skills/obsidian-brain/SKILL.md
vim plugins/personal/skills/obsidian-brain/references/routing-rules.md
```

### 2. VALIDATE (before publishing)

```bash
# Security scan
npx vskill scan plugins/personal/skills/obsidian-brain/SKILL.md

# SKILL.md under 500 lines
wc -l plugins/personal/skills/obsidian-brain/SKILL.md

# No personal paths leaked
grep -rn "personal-docs\|/Users/\|/home/" plugins/personal/skills/obsidian-brain/
# Must return nothing

# Scripts pass syntax check
bash -n plugins/personal/skills/obsidian-brain/scripts/detect-changes.sh
bash -n plugins/personal/skills/obsidian-brain/scripts/update-index.sh
bash -n plugins/personal/skills/obsidian-brain/scripts/lint-check.sh

# Unit tests pass
npx vitest run
```

### 3. BUMP VERSION

Edit `SKILL.md` frontmatter:
```yaml
metadata:
  version: 1.1.0  # ← change this
```

### 4. COMMIT + PUSH

```bash
git add plugins/personal/skills/obsidian-brain/
git commit -m "feat: description of change"
git push origin main
```

### 5. SUBMIT TO REGISTRY

```bash
# Default: programmatic API submission (no browser)
npx vskill submit anton-abyzov/vskill --skill obsidian-brain \
  --path plugins/personal/skills/obsidian-brain/SKILL.md

# Browser fallback (OAuth)
npx vskill submit anton-abyzov/vskill --skill obsidian-brain --browser

# Direct API (curl)
curl -X POST https://verified-skill.com/api/v1/submissions \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl": "https://github.com/anton-abyzov/vskill",
    "skillName": "obsidian-brain",
    "skillPath": "plugins/personal/skills/obsidian-brain/SKILL.md",
    "source": "cli-auto"
  }'
```

### 6. CHECK STATUS

```bash
npx vskill info obsidian-brain       # Registry details
npx vskill versions obsidian-brain   # Version history
npx vskill outdated                  # Local vs registry comparison
npx vskill list                      # All installed skills
npx vskill list --json               # JSON format with SHA + version
```

### 7. INSTALL / UPDATE

```bash
# First install
npx vskill install anton-abyzov/vskill/obsidian-brain

# Update to latest
npx vskill update obsidian-brain

# Update ALL skills
npx vskill update

# Pin to version
npx vskill install obsidian-brain@1.1.0

# Check lockfile
cat vskill.lock | python3 -m json.tool
```

---

## Auto-Submission Triggers

### Currently Implemented

| Trigger | When | How |
|---------|------|-----|
| **Install of unregistered plugin** | `vskill install --repo` for unverified skill | Calls `submitSkill()` with `source: "cli-auto"` |
| **Manual submit** | `vskill submit owner/repo --skill name` | API call or browser OAuth |

### Recommended Triggers (to implement)

| Trigger | When | Priority |
|---------|------|----------|
| **GitHub Actions on release** | Tagged release or push to main with SKILL.md changes | High |
| **npm postpublish hook** | After `npm publish` of vskill package | High |
| **vskill outdated → auto-resubmit** | When `vskill outdated` detects SHA mismatch | Medium |
| **Scheduled registry crawl** | Platform cron checks known repos for changes | Low |

---

## Submission State Machine

```
RECEIVED → TIER1_SCANNING → TIER2_SCANNING → AUTO_APPROVED → PUBLISHED
                ↓                  ↓
          TIER1_FAILED       TIER2_FAILED
```

- **Tier 1**: Pattern scanning (38 rules, deterministic)
- **Tier 2**: LLM-based intent analysis (is this skill malicious?)
- **Auto-approved**: Transient state before PUBLISHED
- **Priority**: `cli-auto` gets priority 90 (vs 50 for browser submissions)

---

## Lockfile Structure (vskill.lock)

```json
{
  "version": 1,
  "agents": ["claude-code", "cursor", "codex", ...],
  "skills": {
    "obsidian-brain": {
      "version": "1.1.0",
      "sha": "c3a47760...",
      "tier": "VERIFIED",
      "installedAt": "2026-04-15T...",
      "source": "github:anton-abyzov/vskill",
      "scope": "project",
      "pinnedVersion": null,
      "files": ["SKILL.md", "references/...", "scripts/..."],
      "lastUpdateCheck": "2026-04-15T..."
    }
  },
  "createdAt": "...",
  "updatedAt": "..."
}
```

### Lockfile Scoping

| Lockfile | Location | Scope |
|----------|----------|-------|
| Project | `./vskill.lock` | Skills installed for THIS project only |
| Global | `~/.agents/vskill.lock` | Skills installed globally for all projects |

- `vskill install` → project lockfile (CWD)
- `vskill install --global` → global lockfile
- `vskill list` reads from project lockfile at CWD

---

## Skill Studio Testing

### Launch Studio

```bash
cd repositories/anton-abyzov/vskill
npx vskill studio
# → Open http://localhost:3077
```

### Test Agent-Aware Routing

1. Open Create Skill page
2. Select target agents (e.g., Claude Code + Codex)
3. Enter skill description
4. Generate → verify:
   - Claude-only: full BODY_SYSTEM_PROMPT (hooks, slash commands, MCP)
   - Codex included: `## Target Agent Constraints` section appended
   - Constraints derived from agent feature flags, not hardcoded
5. Check generated SKILL.md preview has `target-agents:` in frontmatter

### Test Agent Selection UI

1. AgentSelector shows all agents grouped (Universal / Others)
2. Feature indicators visible (slash commands, hooks, MCP, custom prompt)
3. Installed agents have visual badge
4. Toggling checkbox updates selection

### Test /api/agents/installed

```bash
curl http://localhost:3077/api/agents/installed | python3 -m json.tool
# → 49 agents with id, displayName, featureSupport, isUniversal, installed
```

---

## Testing Scenarios

### Scenario 1: Full Version Lifecycle

```
1. Edit SKILL.md (add a comment)
2. Bump version 1.1.0 → 1.1.1
3. git commit + push
4. vskill submit (programmatic)
5. vskill install (verify new SHA in lockfile)
6. vskill list --json (verify version matches)
```

### Scenario 2: Credential Guard

```
1. Create test file with "api_key: test123abc" in raw/inbox/
2. Run obsidian-brain ingest
3. Verify: file routed to credentials folder, NOT wiki
4. Verify: log.md has !cred entry
```

### Scenario 3: Domain-Aware Routing

```
1. Create file "EasyChamp Stripe Key.md" with API key in inbox
2. Run ingest
3. Verify: routed to 002 Areas/EasyChamp Business Operations/ (not generic credentials)
```

### Scenario 4: Agent-Aware Skill Generation

```
1. Launch vskill studio
2. Create skill targeting Claude Code only → no constraint section
3. Create same skill targeting Claude + Codex → constraint section appended
4. Verify constraint text mentions: no hooks, no slash commands
```

### Scenario 5: Outdated Detection

```
1. Install obsidian-brain v1.1.0
2. Bump source to v1.1.1 + push
3. vskill submit
4. vskill outdated → shows: Installed 1.1.0 | Latest 1.1.1 | Bump: patch
5. vskill update obsidian-brain → updates to 1.1.1
6. vskill list --json → confirms 1.1.1
```

---

## Key File Paths

| What | Path |
|------|------|
| Skill source | `repositories/anton-abyzov/vskill/plugins/personal/skills/obsidian-brain/` |
| SKILL.md | `plugins/personal/skills/obsidian-brain/SKILL.md` |
| References | `plugins/personal/skills/obsidian-brain/references/` |
| Scripts | `plugins/personal/skills/obsidian-brain/scripts/` |
| Evals | `plugins/personal/skills/obsidian-brain/evals/evals.json` |
| Submit command | `src/commands/submit.ts` |
| Install command | `src/commands/add.ts` |
| Update command | `src/commands/update.ts` |
| Outdated command | `src/commands/outdated.ts` |
| Agent registry | `src/agents/agents-registry.ts` |
| Skill Studio routes | `src/eval-server/skill-create-routes.ts` |
| Canonical installer | `src/installer/canonical.ts` |
| Frontmatter parser | `src/installer/frontmatter.ts` |
| API client | `src/api/client.ts` |
| CLI entry | `src/index.ts` |
| This document | `docs/skill-lifecycle-testing.md` |
