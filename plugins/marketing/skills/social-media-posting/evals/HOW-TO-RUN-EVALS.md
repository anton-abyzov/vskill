# How to Run Evals for the Social Media Posting Skill

This guide explains how to add test cases, run benchmarks, and measure whether your skill actually improves LLM output.

## How Evals Work

**Evals test the skill's plan, not its execution.** The system doesn't actually post to social media, generate images with Nano Banana, or call any external APIs.

Here's what happens:

1. Your **SKILL.md** is loaded as the LLM's system prompt
2. The **eval prompt** (e.g., "Post about Claude 5 on X and LinkedIn") is sent to the LLM
3. The LLM generates a **text response** describing what it would do
4. An **LLM judge** reads that response and grades each assertion

For example, the `aspect-ratios` assertion checks: does the LLM's response mention using 16:9 for X, 1.91:1 for LinkedIn, and 1:1 for Threads? If your SKILL.md clearly documents these ratios, the LLM will include them. If it's vague, the assertion fails — telling you exactly what to improve in your skill description.

Think of it like testing a recipe book: you don't cook the food, you check whether someone reading your recipe would know the right steps.

## Quick Start

```bash
# Launch the visual eval UI
npx vskill eval serve --root plugins/marketing/skills/social-media-posting
```

Open the URL it prints. You'll see your eval cases with previous benchmark results (if any). Click **Run** on any individual case, or go to the Benchmark page to run all at once.

## Adding a Test Case

Open `evals.json` and add a new entry:

```json
{
  "id": 5,
  "name": "your-test-name",
  "prompt": "Write exactly what you would say to Claude. Be specific and realistic.",
  "expected_output": "Describe what a good result looks like (for your reference, not graded).",
  "files": [],
  "assertions": [
    {
      "id": "short-id",
      "text": "A specific, checkable thing the skill should make Claude do",
      "type": "boolean"
    }
  ]
}
```

Or use the UI — click **+ Add Eval Case** on the skill detail page.

### Tips for Good Test Cases

**Good prompts** are realistic and detailed:
- "Post about our Series A funding on LinkedIn, X, and Threads. We raised $12M led by Sequoia."
- "I need to post a product demo video to Instagram Reels and TikTok. The video is at /tmp/demo.mp4"
- "Go reply to some AI threads on Reddit today, but be careful — my account got a warning last week"

**Bad prompts** are too vague:
- "Post something" (too vague)
- "Use the skill" (not how a real user talks)

**Good assertions** are specific and objectively checkable:
- "Generates 3 image options using Nano Banana Pro"
- "Waits for explicit user approval before posting"
- "Respects Reddit anti-spam rules: max 3 comments per thread per hour"

**Bad assertions** are subjective:
- "Output is good" (what does good mean?)
- "Works correctly" (too broad)

## Three Ways to Evaluate

### 1. Benchmark (pass/fail per assertion)

Tests your skill against each eval case. Shows pass rate, time, and tokens per case.

In the UI: Click **Run Benchmark** or use per-case **Run** buttons.

```bash
# CLI alternative
npx vskill eval run plugins/marketing/skills/social-media-posting
```

### 2. A/B Comparison (with skill vs without)

Runs each prompt **twice**: once WITH your skill loaded, once WITHOUT (vanilla LLM). A blind LLM judge scores both outputs on content (1-5) and structure (1-5). The outputs are randomly shuffled so the judge can't tell which used the skill.

Results include grouped bar charts comparing scores across all eval cases, plus a verdict: EFFECTIVE, MARGINAL, INEFFECTIVE, or DEGRADING.

In the UI: Click **Compare A/B** on the skill detail page.

### 3. Activation Testing

Tests whether the skill correctly triggers on relevant prompts and stays quiet on irrelevant ones. Measures precision, recall, and reliability.

## Iterating on Your Skill

The workflow:

1. **Run benchmark** — see which assertions fail
2. **Read the judge's reasoning** — expand each assertion to understand why it failed
3. **Improve SKILL.md** — add missing details, clarify ambiguous sections
4. **Re-run** — check if pass rate improved
5. **Run A/B comparison** — confirm the skill adds value vs vanilla LLM

Previous results are saved automatically. The skill detail page shows your last benchmark results inline without re-running. Use the **History** page to compare across runs.

## Viewing Results

Results persist between sessions. When you open the eval UI:
- **Skill detail page** — shows last benchmark results inline (pass/fail per assertion, time, tokens)
- **Benchmark page** — shows previous results with per-case status pills
- **History page** — lists all previous benchmark and comparison runs with timestamps
