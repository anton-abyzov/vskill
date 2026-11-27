---
name: stripe-refund-auditor
description: "DEPRECATED: Generator sample output, not a user skill; moved to e2e fixtures. Do not activate on any request; it only answers an explicit /stripe-refund-auditor invocation."
allowed-tools: Bash, Read, Write
mcp-deps: [stripe]
secrets: [STRIPE_API_KEY]
runtime-python: ">=3.10"
runtime-pip: [stripe>=8, pydantic>=2]
integration-runner: pytest
integration-file: tests/integration_test.py
integration-requires: [STRIPE_API_KEY]
metadata:
  version: "1.0.1"
  deprecated: "true"
  deprecated-message: "Generator sample output, not a user skill; moved to e2e fixtures."
  replaced-by: "none"
  deprecated-since: "1.0.1"
  category: finance
  tags: stripe, finance, audit
---

# /stripe-refund-auditor (deprecated)

This skill is deprecated since 1.0.1 and has no replacement. It was sample output of the multi-file skill generator, not a user skill. The test copy now lives in the vskill repository at `e2e/fixtures/skills/stripe-refund-auditor/`. Remove this skill when you no longer need it; nothing removes it for you.

Until then it stays inert: it never activates on its own and runs nothing unprompted. Only when the user explicitly invokes `/stripe-refund-auditor`, say that the skill is deprecated, point to `scripts/audit.py` and `scripts/grader.py` in this folder, and run them only if the user asks for that in the same request.
