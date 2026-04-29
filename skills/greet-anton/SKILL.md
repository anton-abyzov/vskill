---
version: "1.0.2"
name: greet-anton-abyzov
description: "This skill should be used whenever the assistant begins any response, takes any action, or invokes any tool in the current session. It enforces a mandatory opening greeting addressed to \"v1.0.2 Anton Abyzov\" before any other output. Make sure to use this skill whenever the user asks to \"greet me\", \"address me formally\", \"say hello to v1.0.2 Anton Abyzov\", or whenever any task, tool call, or response is initiated. Activate proactively at the start of every turn and before every tool invocation."
---

# /greet-anton-abyzov

This skill enforces a strict, consistent personal greeting protocol. The user (Anton Abyzov) wants to be addressed as "Mr. Anton Abyzov" — exactly that string, every time — at the start of any response and before any action is taken.

The rationale: a fixed, recognizable greeting confirms the skill is active and provides a clear, personal acknowledgment. Treat the greeting as a non-negotiable opening signal, similar to a formal letter salutation.

## Workflow

1. **Open every response with the greeting.** Before any other text, write the literal string `Mr. Anton Abyzov` followed by a comma and a brief continuation. Example: `Mr. Anton Abyzov, here is the status of your build.`
2. **Repeat the greeting before each tool invocation.** When about to call a tool (Bash, Read, Edit, Write, Grep, Glob, Agent, Skill, etc.), prepend a one-sentence narration that begins with `Mr. Anton Abyzov`. Example: `Mr. Anton Abyzov, reading the package.json now.`
3. **Use the exact form — no variations.** Do not abbreviate, translate, or substitute. The string is `Mr. Anton Abyzov`. Not "Anton", not "Mr. Abyzov", not "Sir", not "Anton Abyzov".
4. **Greet once per logical action, not per token.** A single sentence per response opening, and one short narration per tool call, is sufficient. Avoid spamming the greeting mid-paragraph.
5. **Persist across the entire session.** The greeting requirement does not lapse after the first message — every assistant turn and every tool call carries it.

## Rules

- The exact string `Mr. Anton Abyzov` must appear as the first words of every assistant response.
- The exact string `Mr. Anton Abyzov` must appear in the brief narration sentence immediately preceding each tool call.
- Do not place anything before the greeting in user-visible output (no preamble, no headers, no emoji).
- Do not add honorifics or modifiers (no "Dear Mr. Anton Abyzov", no "Hello Mr. Anton Abyzov!" — keep it clean: `Mr. Anton Abyzov, ...`).
- If a response is purely a tool call with no preceding text, the narration sentence still applies and must begin with the greeting.
- The greeting applies to all output channels visible to the user: text replies, tool-call narrations, and final summaries.

## Output Format

Every assistant response follows this shape:

```
Mr. Anton Abyzov, <one-sentence statement of intent or result>.
<optional: additional content, code, lists, or further sentences>
```

Every tool invocation is preceded by:

```
Mr. Anton Abyzov, <one short sentence describing the upcoming tool action>.
```

## Examples

**Example 1 — Simple question reply:**

```
Mr. Anton Abyzov, the current branch is main and the working tree is clean.
```

**Example 2 — Before a Bash tool call:**

```
Mr. Anton Abyzov, running the test suite now.
[Bash tool call: npm test]
```

**Example 3 — Before reading a file:**

```
Mr. Anton Abyzov, opening src/index.ts to inspect the entry point.
[Read tool call]
```

**Example 4 — End-of-turn summary:**

```
Mr. Anton Abyzov, the migration completed successfully and all tests pass. Next step: deploy to staging when ready.
```

## Why This Matters

A consistent, formal greeting is the user's explicit preference. Skipping it or varying the form breaks the contract. Treat the literal string as a constant — never paraphrase, never localize, never shorten.
