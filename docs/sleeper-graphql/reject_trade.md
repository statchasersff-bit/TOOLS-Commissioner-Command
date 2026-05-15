# reject_trade

Rejects (or withdraws) a pending trade offer. Used both by the receiving party to
decline an offer and by the proposing party to withdraw their own offer.

## Endpoint

```
POST https://sleeper.com/graphql
```

## Headers

```
Content-Type: application/json
authorization: <JWT>                      ← raw token, NO "Bearer" prefix
x-sleeper-graphql-op: RejectTrade
```

> **Note:** The `x-sleeper-graphql-op` value is `"RejectTrade"` (PascalCase) — this is
> inconsistent with other operations which use snake_case. Using lowercase `"reject_trade"`
> may fail or cause unexpected behaviour.

## Mutation

`league_id` is embedded as a string literal. `transaction_id` and `leg` are variables.

```graphql
mutation RejectTrade($transactionId: String!, $leg: Int!) {
  reject_trade(
    league_id: "<leagueId>"
    transaction_id: $transactionId
    leg: $leg
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

| Variable        | Type     | Description                                          |
|-----------------|----------|------------------------------------------------------|
| `transactionId` | `String!`| The Sleeper transaction ID to reject/withdraw        |
| `leg`           | `Int!`   | Leg number — almost always `1`; use `trade.leg` from the transaction |

> **Important:** The variable name in the query is `$transactionId` (camelCase), but the
> GQL argument name passed to `reject_trade(...)` is `transaction_id` (snake_case). Both
> must be correct.

## Response

Returns the full updated transaction object with `status: "rejected"` (or `"cancelled"`
if withdrawn by the proposer).

```json
{
  "data": {
    "reject_trade": {
      "transaction_id": "1234567890",
      "type": "trade",
      "status": "rejected",
      "leg": 1,
      "creator": "<userId>",
      "roster_ids": [3, 7],
      "consenter_ids": [],
      "adds": { "4035": 3, "6797": 7 },
      "drops": { "4035": 7, "6797": 3 },
      "draft_picks": [],
      "waiver_budget": [],
      "settings": null,
      "metadata": null,
      "player_map": null,
      "league_id": "<leagueId>",
      "created": 1735000000000,
      "status_updated": 1735001000000
    }
  }
}
```

### Status values after reject

| Value      | Set when                                    |
|------------|---------------------------------------------|
| `rejected` | Receiving party declines the offer          |
| `cancelled`| Proposing party withdraws their own offer   |

## Required Fields

- `league_id` — embedded literal
- `transactionId` — the transaction to reject
- `leg` — must match the transaction's `leg` field; default to `1` if unknown

## Known Quirks

- The `x-sleeper-graphql-op` header value is **`"RejectTrade"`** (PascalCase), not
  `"reject_trade"`. This is a confirmed inconsistency in Sleeper's API.
- `leg` defaults to `1` in most standard trades. Only multi-leg transactions use
  higher values.
- When used as part of an "Edit & Resend" flow, call `reject_trade` **first**, then
  call `propose_trade` for the new offer. If `propose_trade` fails after a successful
  `reject_trade`, the original offer is permanently gone — inform the user and direct
  them to re-propose manually on Sleeper.
- Calling `reject_trade` on an already-complete transaction returns an error.
- The full transaction body is returned (unlike `accept_trade` which returns a slim
  object). Useful for updating local state directly without a refetch.

## Failure Cases

| Symptom                           | Likely Cause                                            |
|-----------------------------------|---------------------------------------------------------|
| `data.reject_trade` is `null`     | Transaction already complete, rejected, or not found    |
| HTTP 401                          | Token expired or invalid                                |
| GraphQL error `"not authorized"`  | User is not a party to this transaction                 |
| Unexpected 400                    | Wrong casing on `x-sleeper-graphql-op` header           |

## Post-action

After a successful reject, call:

```
league_transactions_filtered(league_id, type_filters: ["trade"])
```

to remove the rejected offer from local state.
