# vskill

**Secure multi-platform AI skill installer.** Scan before you install.

```bash
npx vskill add owner/repo
```

## Why?

- **36.82% of AI skills have security flaws** ([Snyk ToxicSkills](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/))
- Zero versioning on major platforms — updates can inject malware silently
- No pre-install scanning — you're trusting blindly

vskill fixes this with **three-tier verification** and **version-pinned trust**.

## Commands

```bash
vskill add <owner/repo>     # Install skill after security scan
vskill scan <source>         # Scan without installing
vskill list                  # Show installed skills with status
vskill submit <source>       # Submit for verification on verified-skill.com
vskill update                # Update with diff scanning
```

## 39 Agent Platforms

Works across Claude Code, Cursor, GitHub Copilot, Windsurf, Codex, Gemini CLI, Cline, Amp, Roo Code, and 30 more.

## Three-Tier Verification

| Tier | Method | Badge |
|------|--------|-------|
| **Scanned** | 37 deterministic pattern checks | Basic Trust |
| **Verified** | Scanner + LLM intent analysis | Recommended |
| **Certified** | Full manual security review | Highest Trust |

## Version Pinning

Every install creates a `vskill.lock` with SHA, scan date, and tier. Updates run diff scanning — new patterns flagged before install.

## Registry

Browse verified skills at [verified-skill.com](https://verified-skill.com).

## License

MIT
