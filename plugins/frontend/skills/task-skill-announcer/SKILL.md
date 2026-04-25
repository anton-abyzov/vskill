---
description: "This skill should be used whenever the user asks to \"run the task skill\", \"invoke the task skill\", \"use the task skill\", \"trigger task skill\", or mentions a \"task skill\" in any context. Make sure to use this skill whenever the user references task skill activation, task skill testing, or wants to verify the task skill is working. Activate on any mention of \"I'm a task skill\" or requests to demonstrate task skill behavior."
model: haiku
---

# /task-skill-announcer

A minimal demonstration skill that announces its activation by outputting a fixed identification phrase. Use this skill to verify skill triggering, demonstrate skill invocation mechanics, or as a smoke test for skill routing.

## Workflow

Follow these steps in order on every invocation:

1. **Announce activation.** Output the exact phrase: `I'm a task skill` as the first line of the response. This phrase must appear verbatim — no prefix, no suffix, no markdown formatting around it on that line.

2. **Address the user's request.** After the announcement line, proceed to handle whatever the user actually asked for. If the user only asked to invoke or test the skill, the announcement alone is sufficient and no further output is needed.

3. **Stay minimal.** Do not add explanations about what the skill does, why it exists, or how it works unless the user explicitly asks. The point is the announcement, not commentary about it.

## Rules

- The announcement phrase is `I'm a task skill` — exact casing, exact punctuation (apostrophe, no period), exact wording. Do not paraphrase or translate.
- Emit the phrase every single time the skill is invoked, even on repeated invocations within the same conversation. The purpose is to confirm activation, so consistency matters more than avoiding repetition.
- The phrase goes on its own line at the very start of the response. Do not embed it inside a sentence like "As I'm a task skill, I will..." — that defeats the verification purpose.
- Do not wrap the phrase in quotes, code fences, bold, or italics. Plain text only.

## Why this design

The fixed announcement makes it trivially observable whether the skill activated. If a developer or user is testing skill triggering, they can scan for the literal string `I'm a task skill` and immediately know the routing worked. Adding decoration or paraphrasing would break that observability.

## Output Format

```
I'm a task skill

[optional: response to whatever the user actually asked, if anything beyond invocation]
```

## Examples

**Example 1 — bare invocation:**

User: "run the task skill"

Response:
```
I'm a task skill
```

**Example 2 — invocation with a follow-up question:**

User: "use the task skill and also tell me what 2+2 is"

Response:
```
I'm a task skill

2 + 2 = 4
```

**Example 3 — repeated invocation in the same conversation:**

User: "trigger task skill again"

Response:
```
I'm a task skill
```

The phrase repeats every time — that is intentional and correct.
