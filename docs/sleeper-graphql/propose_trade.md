# propose_trade

Proposes a new trade offer, or counters an existing one.

## Endpoint

```
POST https://sleeper.com/graphql
```

## Headers

```
Content-Type: application/json
authorization: <JWT>                      ← raw token, NO "Bearer" prefix
x-sleeper-graphql-op: propose_trade
```

## Mutation

`league_id`, `draft_picks`, `expires_at`, and optionally `reject_transaction_id` /
`reject_transaction_leg` are embedded as **string literals** directly in the mutation
body — NOT passed as GraphQL variables. Only `k_adds`, `v_adds`, `k_drops`, `v_drops`
are passed as variables.

```graphql
mutation propose_trade(
  $k_adds: [String],
  $v_adds: [Int],
  $k_drops: [String],
  $v_drops: [Int]
) {
  propose_trade(
    league_id: "<leagueId>",
    reject_transaction_id: "<txId>",    # only when countering
    reject_transaction_leg: <leg>,      # only when countering
    draft_picks: <picksCsvArray>,       # JSON-serialised string array
    k_adds: $k_adds,
    v_adds: $v_adds,
    k_drops: $k_drops,
    v_drops: $v_drops,
    waiver_budget: [],
    expires_at: <unixSeconds>,          # optional
  ) {
    adds
    consenter_ids
    created
    creator
    draft_picks
    drops
    league_id
    leg
    metadata
    roster_ids
    settings
    status
    status_updated
    transaction_id
    type
    player_map
    waiver_budget
  }
}
```

## Variables

| Variable  | Type      | Description                                                  |
|-----------|-----------|--------------------------------------------------------------|
| `k_adds`  | `[String]`| Player IDs being added (received by someone)                 |
| `v_adds`  | `[Int]`   | Parallel array: roster ID receiving each player in `k_adds`  |
| `k_drops` | `[String]`| Player IDs being dropped (sent away)                         |
| `v_drops` | `[Int]`   | Parallel array: roster ID sending each player in `k_drops`   |

### Adds / Drops encoding

```
adds[playerId]  = receiving roster ID
drops[playerId] = sending roster ID
```

Both sides of the trade must be represented. For a two-sided swap:

```
Side A gives player X → adds[X] = rosterB, drops[X] = rosterA
Side A gives player Y → adds[Y] = rosterB, drops[Y] = rosterA
Side B gives player Z → adds[Z] = rosterA, drops[Z] = rosterB
```

### Draft picks CSV format

Picks are passed as a JSON-serialised array of CSV strings. Each string:

```
"<originalRosterId>,<season>,<round>,<ownerRosterId>,<previousOwnerRosterId>"
```

- `originalRosterId` — the roster that originally owned the pick slot
- `ownerRosterId` — the roster receiving the pick
- `previousOwnerRosterId` — the roster sending the pick

Example:

```json
["3,2025,1,5,3", "7,2026,2,3,7"]
```

### expires_at

Unix timestamp in **seconds** (not milliseconds). Omit to use Sleeper's default expiry.
To preserve an existing trade's expiry: `Math.floor(trade.expiresAt / 1000)` (our
`NormalizedTrade.expiresAt` is in milliseconds).

### Counter vs. fresh offer

| Scenario            | Include `reject_transaction_id`? | Include `reject_transaction_leg`? |
|---------------------|----------------------------------|-----------------------------------|
| New trade proposal  | No                               | No                                |
| Counter offer       | Yes — the tx being rejected      | Yes — usually `1` or `trade.leg`  |
| Edit & Resend       | No — withdraw first via separate `reject_trade` call, then propose fresh |

## Response

```json
{
  "data": {
    "propose_trade": {
      "transaction_id": "1234567890",
      "type": "trade",
      "status": "proposed",
      "leg": 1,
      "creator": "<userId>",
      "roster_ids": [3, 7],
      "consenter_ids": [],
      "adds": { "4035": 3, "6797": 7 },
      "drops": { "4035": 7, "6797": 3 },
      "draft_picks": [],
      "waiver_budget": [],
      "settings": { "expires_at": 1735689600 },
      "metadata": null,
      "player_map": { "4035": { "full_name": "...", "position": "QB", "team": "KC" } },
      "league_id": "<leagueId>",
      "created": 1735000000000,
      "status_updated": null
    }
  }
}
```

## Required Fields

- `league_id` — embedded literal in mutation
- `k_adds` / `v_adds` — at least one player or pick must be on each side
- `k_drops` / `v_drops` — parallel to adds
- `waiver_budget: []` — must always be present, even if empty

## Known Quirks

- `league_id` **must** be a literal in the mutation body, not a variable. Passing it as a
  `$league_id: String!` variable returns a 400.
- `draft_picks` is passed as a JSON-encoded array of CSV strings (`JSON.stringify(picksCsv)`),
  not as structured objects.
- `waiver_budget: []` is required even when no FAAB is involved.
- When countering, the `reject_transaction_id` causes Sleeper to atomically reject the
  existing offer and create the new one. If either step fails, the entire operation fails.
- The `x-sleeper-graphql-op` header value must be exactly `"propose_trade"` (lowercase,
  underscore). Mismatches cause a 400 or silent failure.

## Failure Cases

| Symptom                             | Likely Cause                                              |
|-------------------------------------|-----------------------------------------------------------|
| `data.propose_trade` is `null`      | Invalid player/roster mapping; a player is not on that roster |
| HTTP 400                            | `league_id` passed as variable instead of literal         |
| HTTP 401                            | Token expired or invalid                                  |
| GraphQL error `"not authorized"`    | Logged-in user is not a member of the league              |
| GraphQL error on counter            | `reject_transaction_id` already rejected or not proposed  |

## Post-action

After a successful propose, call:

```
league_transactions_filtered(league_id, type_filters: ["trade"])
```

to sync local state.
