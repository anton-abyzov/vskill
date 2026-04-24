---
name: tournament-manager
description: "Tournament manager — creates leagues, tournaments, brackets, schedules, and enters results via the EasyChamp MCP."
metadata:
  version: 0.1.0
  author: Anton Abyzov
  homepage: https://easychamp.com
mcp-deps:
  - easychamp
---

# Tournament Manager (EasyChamp)

Uses the EasyChamp MCP tools `easychamp_generate_league`, `easychamp_generate_tournament`,
`easychamp_generate_bracket`, `easychamp_create_schedule`, and `easychamp_enter_results`
to run a tournament end-to-end.
