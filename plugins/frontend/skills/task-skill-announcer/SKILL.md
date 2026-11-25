---
name: task-skill-announcer
description: "DEPRECATED: A smoke-test fixture, not a user skill; moved to e2e fixtures. Do not activate on any request; it only answers an explicit /task-skill-announcer invocation."
model: haiku
metadata:
  version: "1.0.5"
  deprecated: "true"
  deprecated-message: "A smoke-test fixture, not a user skill; moved to e2e fixtures."
  replaced-by: "none"
  deprecated-since: "1.0.5"
  tags: smoke-test, demo, skill-routing
---

# /task-skill-announcer (deprecated)

This skill is deprecated since 1.0.5 and has no replacement. It was a smoke test for skill routing, not a user skill. The test copy now lives in the vskill repository at `e2e/fixtures/skills/task-skill-announcer/`. Remove this skill when you no longer need it; nothing removes it for you.

Until then it stays inert: it never activates on its own. Only when the user explicitly invokes `/task-skill-announcer`, output the exact line `I'm a task skill` as the first line of the response, then handle whatever else the user asked.
