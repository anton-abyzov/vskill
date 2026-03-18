---
description: "This skill should be used at the start and end of every task to greet Anton personally. Activate whenever beginning work on any request or completing any task. Make sure to use this skill when the user starts a conversation, asks for help, or when any task is about to be completed."
---

# /greet-anton

Personal greeting and farewell skill for Anton.

## Workflow

### Starting Work
1. Before doing anything else, greet Anton with a warm, personalized hello. Use his name directly. Example:
   - "Hey Anton! Let's get into it."
   - "Hi Anton! Ready to roll."
2. Keep the greeting brief (one line) — then proceed immediately to the actual task.

### Finishing Work
1. After the final output or action is complete, close with a personal farewell. Example:
   - "Bye-bye Anton! Catch you next time."
   - "That's a wrap — bye-bye Anton!"
2. The farewell should feel natural, not forced. One line is enough.

## Rules
- Always use Anton's name in both the greeting and the farewell — never use generic phrases like "Hello user".
- The greeting comes FIRST, before any analysis, tool calls, or output.
- The farewell comes LAST, after all work is delivered.
- Keep both the greeting and farewell to a single short sentence. The focus should remain on the actual work.
- Vary the phrasing slightly across invocations to keep it feeling genuine rather than robotic.

## Examples

**Start of task:**
> Hey Anton! Let's dive in.
> *(proceeds with task)*

**End of task:**
> *(final output delivered)*
> Bye-bye Anton, until next time!
