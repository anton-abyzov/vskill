# EasyChamp MCP — Tool Schemas

Reference for the input/output contracts of each tool exposed by the EasyChamp
MCP server (`easychamp-mcp` on npm). Use this when authoring chains that call
multiple tools in sequence so the shapes line up.

All tools are registered on the server via Zod schemas — these documents reflect
those schemas 1:1. Unknown fields are rejected; required fields are marked
explicitly.

---

## `easychamp_generate_league`

**Purpose**: Create a new league under the authenticated organization.

### Input

| Field       | Type     | Required | Notes                                            |
|-------------|----------|----------|--------------------------------------------------|
| `name`      | string   | yes      | Human-readable league name.                      |
| `sport`     | string   | yes      | Lowercased slug: `basketball`, `soccer`, `hockey`, etc. |
| `teamCount` | integer  | yes      | Minimum 2, maximum 128.                          |
| `format`    | enum     | yes      | `single_elim` \| `double_elim` \| `round_robin`. |

### Output

```json
{
  "leagueId": "lg_abc123",
  "name": "Summer Basketball League",
  "sport": "basketball",
  "teams": ["Team 1", "Team 2", "…"]
}
```

---

## `easychamp_generate_tournament`

**Purpose**: Create a tournament inside an existing league.

### Input

| Field       | Type   | Required | Notes                                  |
|-------------|--------|----------|----------------------------------------|
| `leagueId`  | string | yes      | Returned by `easychamp_generate_league`. |
| `type`      | enum   | yes      | `single_elim` \| `double_elim` \| `round_robin`. |

### Output

```json
{
  "tournamentId": "tn_xyz789",
  "leagueId": "lg_abc123",
  "type": "single_elim"
}
```

---

## `easychamp_generate_bracket`

**Purpose**: Build the bracket for a tournament from its registered teams.

### Input

| Field          | Type   | Required | Notes                                   |
|----------------|--------|----------|-----------------------------------------|
| `tournamentId` | string | yes      | Returned by `easychamp_generate_tournament`. |

### Output

```json
{
  "bracketId": "br_abc",
  "rounds": [
    [{ "matchId": "m_1", "home": "Team 1", "away": "Team 8" }, "…"],
    "…"
  ]
}
```

The number of rounds is `log2(teamCount)` for single-elim or
`2 * log2(teamCount) - 1` for double-elim.

---

## `easychamp_create_schedule`

**Purpose**: Produce a schedule with match dates and optional venues.

### Input

| Field          | Type     | Required | Notes                                       |
|----------------|----------|----------|---------------------------------------------|
| `tournamentId` | string   | yes      | Returned by `easychamp_generate_tournament`.|
| `startDate`    | string   | yes      | ISO date `YYYY-MM-DD`.                      |
| `venues`       | string[] | no       | Round-robin assigned across matches if set. |

### Output

```json
{
  "scheduleId": "sc_abc",
  "matches": [
    {
      "matchId": "m_1",
      "date": "2026-06-01T10:00:00Z",
      "venue": "Court A"
    },
    "…"
  ]
}
```

---

## `easychamp_enter_results`

**Purpose**: Record the final score + winner for a single match.

### Input

| Field       | Type    | Required | Notes                                  |
|-------------|---------|----------|----------------------------------------|
| `matchId`   | string  | yes      | Returned by `easychamp_generate_bracket` or `easychamp_create_schedule`. |
| `homeScore` | integer | yes      | ≥ 0.                                   |
| `awayScore` | integer | yes      | ≥ 0.                                   |
| `winner`    | enum    | yes      | `home` \| `away` \| `draw`.            |

### Output

```json
{
  "matchId": "m_42",
  "finalized": true
}
```

Finalized matches cannot be re-scored; the MCP returns a structured error if
`enter_results` is called twice for the same `matchId`.

---

## Auth & Modes

| Mode        | Trigger                                            | Behavior                                            |
|-------------|----------------------------------------------------|-----------------------------------------------------|
| Live        | `EASYCHAMP_API_KEY=<key>` set                      | Calls `https://api.easychamp.com/v1` with Bearer auth. |
| Demo        | `EASYCHAMP_DEMO=1` and no `EASYCHAMP_API_KEY`      | Returns deterministic mock payloads.                |
| No-auth    | Neither env var set                                 | Structured error pointing to https://easychamp.com/account/api-keys. |

The API key is never echoed back in tool responses, logs, or error messages.
