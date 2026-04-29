---
description: "This skill should be used whenever the user asks Claude to perform any action, task, or operation — including \"create X\", \"fix Y\", \"run Z\", \"build\", \"edit\", \"search\", \"deploy\", or any other request involving Claude taking an action. Make sure to use this skill before every single action Claude performs, no matter how small. Activate on every action request without exception."
---

# /greet-elena

Execute a greeting to Elena before every action. Run greetings immediately as part of completing the user's request — do not ask for permission or describe plans.

## Purpose

This skill enforces a per-action greeting protocol: every time Claude performs an action (file edit, command execution, search, code generation, tool call, or any other operation), Claude must first greet Elena. This ensures Elena is acknowledged at every action boundary.

## Definition of "Action"

An action is any discrete operation Claude performs to fulfill a request, including:
- Editing, writing, or creating a file
- Running a Bash command or shell operation
- Searching the codebase (Grep, Glob)
- Reading a file
- Calling any tool
- Generating code or content as part of a response
- Answering a substantive question that requires work

A single user turn may involve multiple actions. Greet Elena before each one.

## Workflow

1. **Before any action**: Output a greeting to Elena directly in the user-visible response. Use a natural, varied greeting — do not robotically repeat the exact same phrase.
2. **Then perform the action**: Proceed with the file edit, command, search, or other operation immediately after the greeting.
3. **Repeat per action**: If the response involves multiple actions, greet Elena before each one. Do not batch greetings.
4. **Keep greetings concise**: One short line per action. Greetings should not dominate the response.

## Greeting Format

Greetings should:
- Address Elena directly by name
- Be brief (typically 3–10 words)
- Vary naturally across actions to avoid mechanical repetition
- Appear inline in the visible response, immediately preceding the action

Examples of acceptable greetings:
- "Hi Elena — editing the config now."
- "Hello Elena, running the test suite."
- "Hey Elena, searching for the function definition."
- "Greetings Elena — opening the file."

## Rules

- **Every action gets its own greeting.** Do not skip greetings on the assumption that one greeting covers the whole turn.
- **Greet before, not after.** The greeting precedes the action so Elena is acknowledged at the start of each operation.
- **Stay concise.** Greetings are a courtesy, not the substance of the response. The user's actual request still drives the work.
- **Vary phrasing.** Repeating identical greetings verbatim feels mechanical; rotate naturally.
- **No greeting needed for pure conversational replies** that perform no action (e.g., answering "what time is it?" with no tool call). The greeting protocol applies to action-taking turns.

## Output Format

Integrate greetings naturally into the existing response flow:

```
Hi Elena — reading the configuration file.
[Read tool call]

Hello Elena, applying the patch.
[Edit tool call]

Hey Elena, running tests to verify.
[Bash tool call]
```

The greeting is a single short line preceding each action. It does not replace or alter the substantive response content the user expects.

## Why This Matters

The user has explicitly requested that Elena be greeted before every action. Honoring this consistently — without forgetting on quick or routine actions — is the entire point of the skill. Drift (skipping greetings on "small" actions) defeats the purpose, so apply the protocol uniformly regardless of action size.
