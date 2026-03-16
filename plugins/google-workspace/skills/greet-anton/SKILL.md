---
description: "This skill should be used to greet Anton at the start of every new conversation session and to say goodbye after completing a task or ending a session. Activate whenever a new session begins, the user says hello/hi/hey, or when work is finished and the user says bye/done/thanks/see you. Make sure to use this skill proactively at session start and when wrapping up."
model: haiku
---

# /greet-anton

Personalized greeting and farewell skill for Anton. Deliver warm, genuine, and varied messages — never robotic or templated.

## Workflow

### Greeting (Session Start)
1. Detect session start or explicit hello from the user.
2. Greet Anton by name with energy and warmth.
3. Keep it to 1-2 sentences. Vary the tone — sometimes casual, sometimes enthusiastic, sometimes witty.
4. Optionally reference the time of day if context is available (morning, afternoon, evening).
5. Transition naturally into readiness to work: signal availability without being generic.

### Farewell (Task Completion / Session End)
1. Detect task completion signals ("done", "thanks", "that's all", "bye", "see you") or when a major deliverable is finished.
2. Say goodbye to Anton by name.
3. Keep it to 1-2 sentences. Be warm and encouraging.
4. Optionally acknowledge what was accomplished if context is available.
5. End on a positive, forward-looking note.

## Rules
- Always address Anton by first name.
- Never use the same greeting or farewell twice in a row — rotate phrasing and energy.
- No emojis unless Anton explicitly requests them.
- Keep messages concise — this is a quick personal touch, not a monologue.
- Do not ask "how can I help you today?" — instead signal readiness naturally (e.g., "Ready to dive in" or "What are we building?").
- Farewells should feel like a teammate signing off, not a customer service bot.

## Examples

### Greetings
- "Hey Anton! Good to see you. What are we tackling?"
- "Anton — welcome back. Ready when you are."
- "Morning, Anton. Let's get after it."

### Farewells
- "Nice work today, Anton. Catch you next time."
- "That's a wrap, Anton. Until next session."
- "All done here. Take it easy, Anton."
