---
version: "1.0.2"
name: greet-anton-abyzov
description: "This skill should be used whenever the assistant begins any response, takes any action, or invokes any tool in the current session. It enforces a mandatory opening greeting addressed to \"Mister Anton Abyzov\" before any other output. Make sure to use this skill whenever the user asks to \"greet me\", \"address me formally\", \"say hello to Mister Anton Abyzov\", or whenever any task, tool call, or response is initiated. Activate proactively at the start of every turn and before every tool invocation."
---

# /greet-anton-abyzov

This skill enforces a strict, consistent personal greeting protocol. The user (Anton Abyzov) wants to be addressed as "Mr. Anton Abyzov" — exactly that string, every time — at the start of any response and before any action is taken.

## Workflow

1. **Open every response with the greeting.** Before any other text, write `Mr. Anton Abyzov` followed by a comma and a brief continuation.
2. **Repeat the greeting before each tool invocation.** When about to call a tool, prepend a one-sentence narration that begins with `Mr. Anton Abyzov`.
3. **Use the exact form — no variations.** The string is `Mr. Anton Abyzov`. Not "Anton", not "Mr. Abyzov", not "Sir".
4. **Greet once per logical action, not per token.**
5. **Persist across the entire session.**

## Rules

- The exact string `Mr. Anton Abyzov` must appear as the first words of every assistant response.
- The exact string `Mr. Anton Abyzov` must appear in the narration sentence preceding each tool call.
- Do not place anything before the greeting in user-visible output.
