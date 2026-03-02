---
description: Mutation testing expert using Stryker Mutator for TypeScript/JavaScript. Analyzes test suite effectiveness by injecting code mutations and measuring kill rates. Use for mutation testing setup, score analysis, survived mutant triage, CI integration, and improving test quality beyond code coverage.
allowed-tools: Read, Write, Edit, Bash
model: opus
context: fork
---

# Mutation Testing Expert - Stryker Mutator

## When to Use

Trigger this skill when the user mentions: "mutation testing", "Stryker", "test quality",
"mutation score", "survived mutants", "mutant", "test effectiveness", "kill rate",
"are my tests good enough", "test suite quality", "weak tests".

## What Is Mutation Testing

Mutation testing measures the **effectiveness** of your test suite, not just what code it
executes. Code coverage tells you which lines ran; mutation testing tells you whether your
tests actually **detect bugs**.

The process:
1. A tool (Stryker) injects small faults ("mutants") into your source code
2. Your test suite runs against each mutant
3. If a test fails, the mutant is **killed** (good -- your tests caught it)
4. If all tests pass, the mutant **survived** (bad -- your tests missed a real bug)

**Mutation score** = killed mutants / total mutants x 100

### Why It Matters

- **80% code coverage can miss 50% of bugs** -- coverage is necessary but not sufficient
- Mutation testing reveals **weak assertions**, missing edge cases, and untested branches
- It answers: "If a bug were introduced here, would my tests catch it?"

## Stryker Mutator (Primary Tool)

### Installation

```bash
# Install Stryker for a TypeScript/JavaScript project
npm install --save-dev @stryker-mutator/core @stryker-mutator/typescript-checker @stryker-mutator/vitest-runner

# Initialize configuration (interactive)
npx stryker init
```

### Configuration: stryker.config.mjs

**Minimal configuration for a Vitest project:**

```javascript
// stryker.config.mjs
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  mutate: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
  ],
  testRunner: 'vitest',
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  reporters: ['html', 'clear-text', 'progress', 'dashboard'],
  coverageAnalysis: 'perTest',
  timeoutMS: 60000,
  thresholds: {
    high: 80,
    low: 60,
    break: null,  // Set to a number to fail CI below this score
  },
};
```

### Running Stryker

```bash
# Full mutation testing run
npx stryker run

# Target specific files
npx stryker run --mutate 'src/services/auth/**/*.ts'

# Incremental mode (only re-test changed code)
npx stryker run --incremental

# With specific log level for debugging
npx stryker run --logLevel debug
```

### Incremental Mode

Incremental mode is essential for fast feedback. It caches previous results and only
re-mutates files that changed since the last run.

```javascript
// stryker.config.mjs
export default {
  // ... other config
  incremental: true,
  incrementalFile: '.stryker-cache/incremental.json',
};
```

```bash
# First run: full analysis (slow)
npx stryker run

# Subsequent runs: only changed files (fast)
npx stryker run --incremental
```

Add `.stryker-cache/` and `.stryker-tmp/` to `.gitignore`.

## Mutation Operators

Stryker applies these mutation operators to your source code:

| Category | Original | Mutant |
|----------|----------|--------|
| **Arithmetic** | `a + b` | `a - b` |
| | `a - b` | `a + b` |
| | `a * b` | `a / b` |
| | `a / b` | `a * b` |
| | `a % b` | `a * b` |
| **Conditional** | `a > b` | `a >= b`, `a < b` |
| | `a < b` | `a <= b`, `a > b` |
| | `a >= b` | `a > b`, `a <= b` |
| | `a === b` | `a !== b` |
| | `a !== b` | `a === b` |
| **Logical** | `a && b` | `a \|\| b` |
| | `a \|\| b` | `a && b` |
| | `!a` | `a` |

## Mutation Score Analysis

### Understanding the Report

After running Stryker, examine the HTML report at `reports/mutation/html/index.html`.

**Score interpretation:**
- **80%+**: Strong test suite -- tests catch most injected faults
- **60-79%**: Adequate but has gaps -- review survived mutants
- **Below 60%**: Significant weaknesses -- tests give false confidence

**Mutant statuses:**
- **Killed**: A test failed when this mutant was active (good)
- **Survived**: All tests passed despite the mutation (bad -- add/fix tests)
- **No coverage**: No test executes this code at all (worst -- add tests)
- **Timeout**: Mutant caused an infinite loop (usually counts as killed)
- **Compile error**: Mutant produced invalid code (ignored)

### Triaging Survived Mutants

When a mutant survives, ask these questions in order:

**1. Is it an equivalent mutant?**
An equivalent mutant changes the code but produces identical behavior -- no test can kill it
because no observable difference exists. Example: `indexOf(x) >= 0` vs `indexOf(x) > 0`
when `x` is never the first element. Exclude the file from `mutate` globs or accept the
lower score.

**2. Is the assertion weak?**
The most common cause. The test runs the code but does not assert on the affected value.
Use inputs where the mutation would produce a different result (e.g. test `calculateTotal(10, 3)`
not `calculateTotal(10, 1)` -- multiplying by 1 and dividing by 1 give the same output).

**3. Is the boundary untested?**
For a survived `age >= 18` -> `age > 18` mutant, add `expect(canVote(18)).toBe(true)` --
the exact boundary value is what distinguishes `>=` from `>`.

**4. Is the code actually untestable or dead?**
If no test can reach the mutated code, you have dead code. Remove it.

### Score Improvement Strategies

**Priority 1: Fix "No coverage" mutants**
These indicate completely untested code. Write tests that at minimum execute these paths.

**Priority 2: Strengthen weak assertions**
Replace `expect(result).toBeTruthy()` with exact value checks like
`expect(result).toEqual({ total: 30, tax: 2.70 })`.

**Priority 3: Add boundary tests**
For every comparison operator, test the exact boundary value (e.g., `isAdult(18)` not just
`isAdult(25)` and `isAdult(10)`).

**Priority 4: Test negation and logical paths**
Ensure both branches of every `if/else` and `&&/||` are tested.

## Integration Patterns

### GitHub Actions Workflow

```yaml
# .github/workflows/mutation-testing.yml
name: Mutation Testing

on:
  pull_request:
    branches: [main, develop]
  # Optional: scheduled full run
  schedule:
    - cron: '0 3 * * 1'  # Weekly Monday 3am

jobs:
  mutation-test:
    runs-on: ubuntu-latest
    timeout-minutes: 60

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Needed for incremental mode

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - run: npm ci

      - name: Restore Stryker cache
        uses: actions/cache@v4
        with:
          path: .stryker-cache
          key: stryker-${{ runner.os }}-${{ hashFiles('src/**/*.ts') }}
          restore-keys: |
            stryker-${{ runner.os }}-

      - name: Run mutation testing (incremental)
        run: npx stryker run --incremental

      - name: Upload mutation report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: mutation-report
          path: reports/mutation/
          retention-days: 14
```

### Incremental PR-Only Testing

For faster CI, only mutate files changed in the PR:

```yaml
      - name: Get changed files
        id: changed
        run: |
          FILES=$(git diff --name-only origin/${{ github.base_ref }}...HEAD \
            -- 'src/**/*.ts' \
            | grep -v '\.test\.' \
            | grep -v '\.spec\.' \
            | grep -v '\.d\.ts' \
            | tr '\n' ',' | sed 's/,$//')
          echo "files=$FILES" >> $GITHUB_OUTPUT

      - name: Run mutation testing on changed files
        if: steps.changed.outputs.files != ''
        run: |
          npx stryker run --mutate "${{ steps.changed.outputs.files }}"
```

### Setting a CI Quality Gate

Fail the build if mutation score drops below a threshold:

```javascript
// stryker.config.mjs
export default {
  thresholds: {
    high: 80,     // Green in report
    low: 60,      // Yellow in report
    break: 60,    // FAIL CI if score drops below this
  },
};
```

## Strategy and Best Practices

### When Mutation Testing Is Valuable

**High value -- always mutate:**
- Payment/billing logic
- Authentication and authorization
- Data validation and sanitization
- Parsers and serializers
- State machines and workflow engines
- Cryptographic operations
- Rate limiters and throttlers
- Business rule engines

**Medium value -- mutate selectively:**
- API route handlers (focus on error handling)
- Database query builders (focus on WHERE clauses)
- Middleware chains (focus on short-circuit logic)

**Low value -- skip or defer:**
- UI components (visual testing is more effective)
- Configuration files and constants
- Auto-generated code (OpenAPI clients, Prisma, GraphQL codegen)
- Thin wrappers around third-party libraries
- Logging and telemetry code
- Migration scripts

### Balancing Quality vs Execution Time

Mutation testing is CPU-intensive. Strategies for speed:
- Use incremental mode for development and PR runs; reserve full runs for nightly/weekly CI
- Target critical modules only -- do not mutate everything at once
- Use `coverageAnalysis: 'perTest'` so Stryker only runs tests that cover each mutant
- Limit `concurrency` to avoid OOM on CI
- Set `timeoutMS`/`timeoutFactor` appropriately for slow test suites

### Common Pitfalls

1. **Trying to reach 100% mutation score** -- diminishing returns past 80%. Some mutants
   are equivalent or test trivial code.

2. **Running mutation testing on the entire codebase at once** -- start with critical
   modules and expand gradually.

3. **Ignoring survived mutants without analysis** -- each survived mutant is a potential
   bug your tests would miss. Triage them.

4. **Not using incremental mode** -- full runs on every commit waste CI minutes.

5. **Mutating generated code** -- exclude auto-generated files, they inflate the
   denominator without adding value.

## Disabling Specific Mutators

If certain mutation operators produce too many equivalent mutants for your codebase:

```javascript
// stryker.config.mjs
export default {
  // Disable specific mutators
  mutator: {
    excludedMutations: [
      'StringLiteral',     // Skip string mutations if you have many display strings
      'ObjectLiteral',     // Skip object literal removal
    ],
  },
};
```

### Score Targets

| Context | Target Score |
|---------|-------------|
| Payment/auth/security code | 80%+ |
| Core business logic | 70%+ |
| Utility libraries | 60%+ |
| General application code | 50%+ |
| Initial adoption (baseline) | Any improvement |
