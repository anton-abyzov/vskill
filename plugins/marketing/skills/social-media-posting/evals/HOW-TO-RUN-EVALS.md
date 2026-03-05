# How to Run Evals for the Social Media Posting Skill

This guide explains how to add your own test cases, run them, and visually compare the quality difference between "with skill" and "without skill."

## What Are Evals?

Evals are test cases that prove the skill works. Each one has:
- A **prompt** — something you'd actually say (e.g., "Post about our new feature on X and LinkedIn")
- **Assertions** — specific things the skill should make Claude do (e.g., "generates 3 image options", "waits for approval")

We run each prompt twice: once with the skill loaded, once without. Then we grade both outputs against the assertions. The difference in scores tells you exactly how much value the skill adds.

## File Structure

```
social-media-posting/
  evals/
    evals.json          <-- Your test cases live here
    HOW-TO-RUN-EVALS.md <-- This file

social-media-posting-workspace/     <-- Created during eval runs
  iteration-1/
    eval-1-breaking-news/
      with_skill/
        outputs/workflow.md    <-- What Claude did WITH the skill
        grading.json           <-- Pass/fail for each assertion
        timing.json            <-- How long it took, tokens used
      without_skill/
        outputs/workflow.md    <-- What Claude did WITHOUT the skill
        grading.json
        timing.json
    benchmark.json             <-- Aggregated scores
```

## Step 1: Add Your Own Test Case

Open `evals/evals.json` and add a new entry to the `evals` array:

```json
{
  "id": 5,
  "name": "your-test-name",
  "prompt": "Write exactly what you would say to Claude. Be specific and realistic. Include details like platform names, topic, any files, etc.",
  "expected_output": "Describe what a good result looks like (this is for your reference, not used by the grader).",
  "files": [],
  "assertions": [
    {
      "id": "short-id",
      "text": "A specific, checkable thing the skill should make Claude do",
      "type": "boolean"
    },
    {
      "id": "another-check",
      "text": "Another thing to verify",
      "type": "boolean"
    }
  ]
}
```

### Tips for Good Test Cases

**Good prompts** are realistic and detailed:
- "Post about our Series A funding on LinkedIn, X, and Threads. We raised $12M led by Sequoia. Here's the press release: [link]"
- "I need to post a product demo video to Instagram Reels and TikTok. The video is at /tmp/demo.mp4"
- "Go reply to some AI threads on Reddit today, but be careful — my account got a warning last week"

**Bad prompts** are too vague:
- "Post something" (too vague)
- "Use the skill" (not how a real user talks)

**Good assertions** are specific and objectively checkable:
- "Generates 3 image options using Nano Banana Pro"
- "Waits for explicit user approval before posting"
- "Converts video to 30fps before Instagram upload"

**Bad assertions** are subjective or vague:
- "Output is good" (what does good mean?)
- "Works correctly" (too broad)

## Step 2: Run the Evals

Ask Claude to run the evals. You can say something like:

> "Run eval 5 from my social-media-posting evals — both with-skill and without-skill."

Or run all of them:

> "Rerun all social-media-posting evals."

Claude will:
1. Spawn agents to run each prompt (with and without the skill)
2. Grade each output against your assertions
3. Build a benchmark comparing the two
4. Open a visual viewer in your browser

## Step 3: Review in the Visual Viewer

The viewer has two tabs:

### "Outputs" Tab
- Shows one test case at a time
- You see the prompt, the full output from the with-skill run, and a text box for your feedback
- Use arrow keys or prev/next buttons to flip through test cases
- Type feedback in the text box (it auto-saves)
- When done, click "Submit All Reviews"

### "Benchmark" Tab
- Shows the numbers: pass rates, token usage, timing
- Compares with-skill vs without-skill side by side
- Shows which specific assertions passed or failed

## Step 4: Iterate

After reviewing, tell Claude what to fix:

> "The replies in eval 3 are too formal for Reddit. Make them more casual."

Claude will update the skill, rerun the evals, and show you new results with the previous iteration's output for comparison.

## Quick Reference: Running Evals Manually

If you want to run evals yourself without asking Claude:

```bash
# The viewer script (launched by Claude during evals):
python3 /path/to/skill-creator/eval-viewer/generate_review.py \
  /path/to/workspace/iteration-N \
  --skill-name "social-media-posting" \
  --benchmark /path/to/workspace/iteration-N/benchmark.json

# For iteration 2+, add comparison to previous:
  --previous-workspace /path/to/workspace/iteration-(N-1)
```

## Example: Full Eval Cycle

1. You edit `evals.json` — add a test: "Post a meme to just Reddit and Discord"
2. You tell Claude: "Run eval 5"
3. Claude spawns 2 agents (with-skill, without-skill), grades them, opens viewer
4. You review in browser, type feedback: "The Discord message used markdown tables, skill says not to"
5. Claude fixes the skill, reruns, opens viewer with before/after comparison
6. You review again — looks good, you say "ship it"
7. Done
