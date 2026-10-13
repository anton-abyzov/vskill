# Private skills repo for a team

Keep your team's skills in a private GitHub repository and install them with
vskill the same way you install public ones. Anyone who can read the repo on
GitHub can install from it; nobody else can, and nothing about a direct install reaches the
public registry at verified-skill.com. Direct GitHub installation is free and
does not require a paid Verified Skills plan. Hosted private publishing is a
separate, explicit workflow described below.

Requires vskill 1.2.0 or later.

## 1. Lay out the repo

```
acme/team-skills            (private)
├── skills/
│   ├── onboarding/
│   │   ├── SKILL.md
│   │   └── references/     # docs SKILL.md links to
│   └── release-checklist/
│       ├── SKILL.md
│       └── scripts/
└── .claude-plugin/         # optional: lets Claude Code load it as a plugin
    ├── marketplace.json
    └── plugin.json
```

Each skill is a folder with a `SKILL.md`. vskill installs the folder's
`references/`, `scripts/`, `assets/`, `agents/` and `tests/` along with it.

The `.claude-plugin` files are optional. With them, Claude Code users can also
run `claude plugin marketplace add acme/team-skills`. A minimal pair:

```json
// .claude-plugin/marketplace.json
{
  "name": "team-skills",
  "owner": { "name": "Acme" },
  "plugins": [
    { "name": "team-skills", "source": "./", "version": "1.0.0" }
  ]
}
```

```json
// .claude-plugin/plugin.json
{ "name": "team-skills", "version": "1.0.0", "description": "Acme's internal skills" }
```

Leave out a `skills` array in `plugin.json`: Claude Code finds `skills/` on its
own and rejects the array form. Check with `claude plugin validate .`.

## 2. Give people access

Access is plain GitHub access. Add the people (or a GitHub team) as readers of
the repo. Removing someone from the repo removes their ability to install or
update.

## 3. Sign in once per machine

vskill reads private repos through the GitHub API with a token. Any one of
these works, checked in this order:

| Source | When to use |
|---|---|
| `VSKILL_GITHUB_TOKEN` env var | CI, or to override everything else for one run |
| `vskill auth login --repos` | Most people. Plain `vskill auth login` only asks for `read:user`, which cannot read private repos |
| `GITHUB_TOKEN` / `GH_TOKEN` env var | Already set in many shells and CI jobs |
| `gh auth login` | If you already use the GitHub CLI, vskill picks up its token |

A fine-grained personal access token needs **Contents: Read** on the skills
repo. A classic token needs the `repo` scope. If your organization enforces
SAML SSO, authorize the token for the organization on GitHub. If it restricts
third-party OAuth apps, an owner has to approve the vskill app before
`vskill auth login --repos` can see org repos (or use `gh` or a PAT instead).

SSH keys alone are not enough: vskill talks to the GitHub API over HTTPS, not
`git clone`.

## 4. Install

```bash
vskill install acme/team-skills/onboarding        # one skill
vskill install --repo acme/team-skills --all      # every plugin in marketplace.json
vskill install acme/team-skills                   # pick interactively
```

Add `--global` to install for your user instead of the current project.

## 5. Stay up to date

```bash
vskill update --all
```

Commit `vskill.lock` so the whole team installs the same skills. Entries from
a private repo carry `"sourcePrivate": true`. For those, `vskill update` only
ever reads the source repo: it never falls back to a registry skill with the
same name. `vskill outdated` checks against the public registry, so it lists
private skills as a count and points you to `vskill update`.

## CI

The workflow's built-in `GITHUB_TOKEN` can only read the repo the workflow
runs in. To install from a different private repo, store a fine-grained token
(Contents: Read on the skills repo) or a GitHub App installation token as a
secret:

```yaml
- run: npx vskill@latest install --repo acme/team-skills --all
  env:
    VSKILL_GITHUB_TOKEN: ${{ secrets.TEAM_SKILLS_TOKEN }}
```

## What stays private

For direct GitHub installs, vskill sends nothing to verified-skill.com from
the CLI or Skill Studio: no name, repo, path, version or hash. Explicit hosted
private publishing sends the selected repo and skill path only to authenticated
private APIs; it does not add the skill to the public catalog.

- no install telemetry,
- no registry lookups or name-based security checks (the local security scan
  still runs on every install and update),
- no auto-submission for scanning; public `vskill submit` refuses private repos,
- no update checks, version history or diffs (`outdated`, `versions`, `diff`,
  `info`, and the Studio's update badges and Versions tab),
- no GitHub token, ever: the CLI and Studio send only the verified-skill
  `vsk_*` token. A `vskill auth login --repos` token is never exchanged.

This covers skills inside a plugin from a private repo too. When GitHub does
not confirm a repo is public (no access, a rate limit, an outage), its skills
are treated as private. To keep public skills updating through a rate limit,
vskill remembers repos it confirmed public in the last 30 days in
`~/.vskill/repo-visibility.json` (public repos only; set
`VSKILL_VISIBILITY_CACHE=0` to turn it off). Otherwise `outdated` and `update`
list the repos they skipped.

On the registry side, the catalog refuses private repositories at intake, the
crawlers skip them, and a repo that is made private drops out of public
listings when its GitHub App webhook reports the change.

## Hosted private publishing and verified versions

Hosted publishing requires a live paid entitlement, membership in the target
account, and a GitHub App installation that can read the selected repository.
A paid plan alone does not grant repository access. Connect the GitHub App at
<https://verified-skill.com/settings/integrations>, then inspect the real
accounts with `vskill orgs list`. Only owners/admins can publish; downloads
require authorized tenant access and a token with read scope.

The workflow below is prepared for **vskill 1.2.8** and **Skill Studio 1.0.65**.
These unpublished release candidates enable the CLI and Studio capability.
The production service remains closed pending manual acceptance and the
platform rollout. Published vskill 1.2.7 and Skill Studio 1.0.64 do not include
this hosted private workflow.

Updating the global npm package updates the CLI and browser-based
`vskill studio`. The native Skill Studio app has its own desktop update.

This workflow is release-gated. If the service returns
`private_publishing_unavailable`, the hosted rollout is closed. Nothing is
submitted publicly as a fallback, and direct private GitHub installs continue
to work. The commands below become usable after the CLI release and hosted
platform rollout are available.

```bash
vskill auth login
vskill orgs list
vskill submit acme/team-skills --skill onboarding \
  --path skills/onboarding/SKILL.md --private --tenant acme
```

The CLI waits for private verification. Use `--no-wait` to return after creating
the submission, then resume with the returned private submission ID:

```bash
vskill submit --private --tenant acme --submission psub_<id>
```

In Skill Studio, choose **Private** in the publish drawer and select the
publishing account. The account list comes from your authenticated memberships.
If none is available, connect the GitHub App and refresh accounts. A clean skill
can be pushed and submitted without creating an empty commit. Verification
status stays in Studio; private submissions have no public catalog link.

Install a published private version by its unique display name:

```bash
vskill install --tenant acme onboarding --agent codex --agent claude-code
vskill install --tenant acme onboarding --version 1.0.0 --global \
  --agent codex --agent claude-code
```

`--version` requires an exact version and pins it. If multiple private skills
share the same display name, use the account skill list's
`repoSlug:skillSlug` identity. The CLI verifies tenant/skill/version identity,
all raw file hashes and sizes, the normalized tree hash, and safe relative
paths before writing. Every text file also receives a local security scan.
Bundles preserve supporting files and executable modes. Hosted installs support
agents that natively read complete skill folders, including Codex, Claude Code,
and Cursor. Transformer-only and clipboard agents are skipped during automatic
detection; selecting one explicitly fails before any files are written. The
verified source frontmatter name is replaced with the isolated installed name
so two accounts cannot create the same agent-visible skill identity.

The installed name includes the account and a stable identity suffix, for
example `private-acme-onboarding-<identity>`. This avoids overwriting a public
skill or another account's skill. The success output gives the exact name.
`vskill.lock` retains the private tenant and artifact provenance. Keep that
lockfile private if it contains confidential repo names or paths.

```bash
vskill update private-acme-onboarding-<identity>
vskill update --global private-acme-onboarding-<identity>
```

Pinned entries are skipped unless you explicitly use `--force`. Hosted updates
use authenticated private download routes, recheck integrity, preserve account
identity, and remove files deleted in the new complete manifest. Access loss,
identity mismatch, or integrity failure never falls back to a public registry
skill. `--global` updates hosted private entries in the global lockfile; other
source types are skipped. Public registry commands such as `versions`, `diff`,
and `outdated` continue to exclude private entries.

Only the platform `vsk_*` credential is sent to private platform routes. GitHub
OAuth/PAT credentials remain on the GitHub side; the service reads repositories
through its scoped GitHub App installation.

## Troubleshooting

**`SKILL.md not found` or `marketplace.json not found`.** GitHub answers 404,
not 403, when a token cannot read a private repo. The error adds a hint when
this is the likely cause. Check that your token has read access (step 3).

**`GitHub rejected your token`.** The token expired or was revoked. Sign in
again. Public skills keep installing and updating anonymously in the meantime.

**`Skipped registry checks for skills from N repos`.** GitHub rate-limited
vskill or could not be reached, so those repos could not be confirmed public.
Set `GITHUB_TOKEN` or run `vskill auth login`, then retry.

**Org repo works with `gh` but not after `vskill auth login`.** Run
`vskill auth login --repos`, or the org has not approved the vskill OAuth app.
