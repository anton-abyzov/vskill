---
name: tournament-manager
description: "Tournament manager for the EasyChamp platform. Use when the user wants to create or operate a sports league, tournament, or bracket — covers generating a league, spinning up a tournament under it, building the bracket, producing a schedule with venues, and entering match results. Activates for 'create a league', 'start a tournament', 'make a bracket', 'schedule matches', 'enter a score', 'record results', 'basketball tournament', 'soccer league', 'single-elim bracket', 'double-elimination', or any EasyChamp-related workflow. Backed by the EasyChamp MCP — requires an EASYCHAMP_API_KEY for live use, or EASYCHAMP_DEMO=1 for offline demos. Do NOT activate for non-sports scheduling (use a generic calendar skill instead) or for tournament-style brackets inside unrelated domains (e.g. 'coding challenge bracket' without EasyChamp — prompt for clarification)."
metadata:
  version: 1.0.3
  author: Anton Abyzov
  homepage: https://easychamp.com
  tags: easychamp, tournament, league, bracket, schedule, results, sports, mcp, showcase
  stability: preview
mcp-deps:
  - easychamp
---

# Tournament Manager (EasyChamp)

Run tournaments end-to-end without leaving Claude — generate a league, spin up a
tournament under it, build the bracket, create the schedule, and enter results
as matches finish. Powered by the **EasyChamp MCP** running over stdio.

## When to Use

- A league needs to be created ("Start the summer basketball league, 8 teams, single-elim").
- A tournament needs to be spun up under an existing league.
- A bracket must be generated from a tournament's team list.
- A match schedule must be produced with optional venue assignments.
- A match result must be recorded against the bracket.

Chain order is usually: `easychamp_generate_league` → `easychamp_generate_tournament` → `easychamp_generate_bracket` → `easychamp_create_schedule` → `easychamp_enter_results` (one per match).

## MCP Tools

All tools live on the EasyChamp MCP server. Invoke them as-is; the server is
configured via the Deps tab snippet (see below).

### `easychamp_generate_league`
Create a new league under the authenticated organization.

Input:
```json
{
  "name": "Summer Basketball League",
  "sport": "basketball",
  "teamCount": 8,
  "format": "single_elim"
}
```

Output: `{ leagueId, name, sport, teams: string[] }`.

### `easychamp_generate_tournament`
Create a tournament inside an existing league.

Input: `{ "leagueId": "lg_abc123", "type": "single_elim" }`
Output: `{ tournamentId, leagueId, type }`.

### `easychamp_generate_bracket`
Build the bracket for a tournament from its registered teams.

Input: `{ "tournamentId": "tn_xyz789" }`
Output: `{ bracketId, rounds: Match[] }`.

### `easychamp_create_schedule`
Produce the schedule with match dates (and optional venues).

Input:
```json
{
  "tournamentId": "tn_xyz789",
  "startDate": "2026-06-01",
  "venues": ["Court A", "Court B"]
}
```

Output: `{ scheduleId, matches: ScheduledMatch[] }`.

### `easychamp_enter_results`
Record the final score + winner for a single match.

Input: `{ "matchId": "m_42", "homeScore": 84, "awayScore": 77, "winner": "home" }`
Output: `{ matchId, finalized: true }`.

## Setup

1. Open the Deps tab in Skill Studio and click **Copy config** next to the EasyChamp row.
2. Paste the snippet into your `~/.claude.json` under `mcpServers`.
3. Export `EASYCHAMP_API_KEY` (from https://easychamp.com/account/api-keys) or set `EASYCHAMP_DEMO=1` for a no-auth demo.

Detailed tool schemas are in [`references/schemas.md`](references/schemas.md).

## Workflow Example

```
1. easychamp_generate_league({ name: "Fall Cup", sport: "soccer", teamCount: 16, format: "double_elim" })
   → leagueId = "lg_fallcup"
2. easychamp_generate_tournament({ leagueId: "lg_fallcup", type: "double_elim" })
   → tournamentId = "tn_fallcup_main"
3. easychamp_generate_bracket({ tournamentId: "tn_fallcup_main" })
   → bracketId = "br_fallcup", rounds: [[Match, Match, ...], ...]
4. easychamp_create_schedule({ tournamentId: "tn_fallcup_main", startDate: "2026-09-01" })
   → scheduleId = "sc_fallcup", matches: [...]
5. easychamp_enter_results({ matchId: "m_1", homeScore: 3, awayScore: 1, winner: "home" })
   → { matchId: "m_1", finalized: true }
```

## Safety

- Never log or echo the `EASYCHAMP_API_KEY`. The copy-config snippet uses the
  `${EASYCHAMP_API_KEY}` placeholder — fill it in from your environment, never
  paste the real value into chat.
- Score entries are final; re-running `easychamp_enter_results` for a matchId
  that is already finalized returns a structured error.
