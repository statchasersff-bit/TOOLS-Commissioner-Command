# accept_trade

Accepts a pending incoming trade offer. The authenticated user must be one of the
`roster_ids` in the transaction and must not already be in `consenter_ids`.

## Endpoint

```
POST https://sleeper.com/graphql
```

## Headers

```
Content-Type: application/json
authorization: <JWT>                      ← raw token, NO "Bearer" prefix
x-sleeper-graphql-op: accept_trade
```

## Mutation

`league_id` is embedded as a string literal in the mutation body. `transaction_id` is
passed as a GraphQL variable.

```graphql
mutation accept_trade($transaction_id: String!) {
  accept_trade(
    league_id: "<leagueId>",
    transaction_id: $transaction_id
  ) {
    transaction_id
    status
    consenter_ids
    roster_ids
  }
}
```

## Variables

| Variable         | Type     | Description                          |
|------------------|----------|--------------------------------------|
| `transaction_id` | `String!`| The Sleeper transaction ID to accept |

## Response

```json
{
  "data": {
    "accept_trade": {
      "transaction_id": "1234567890",
      "status": "complete",
      "consenter_ids": [3, 7],
      "roster_ids": [3, 7]
    }
  }
}
```

### Status values after accept

| Value      | Meaning                                                         |
|------------|-----------------------------------------------------------------|
| `complete` | Both sides have consented — trade is executed and rosters updated |
| `proposed` | Only one side has accepted (multi-leg or multi-party trade)     |

## Required Fields

- `league_id` — embedded literal in mutation
- `transaction_id` — variable

## Known Quirks

- The response only returns 4 fields (`transaction_id`, `status`, `consenter_ids`,
  `roster_ids`). To get the full post-trade transaction, refetch via
  `league_transactions_filtered`.
- `status` becomes `"complete"` only when **all** required `consenter_ids` have accepted.
  In a 2-person trade this is immediate on the second accept.
- Sleeper executes the roster swap server-side at the moment `status` transitions to
  `"complete"`. There is no separate confirmation step.
- Calling `accept_trade` on an already-complete or rejected transaction returns an error.
- The `league_id` must be a literal, not a variable (same quirk as `propose_trade`).

## Failure Cases

| Symptom                              | Likely Cause                                           |
|--------------------------------------|--------------------------------------------------------|
| `data.accept_trade` is `null`        | Transaction already complete or cancelled              |
| HTTP 401                             | Token expired or invalid                               |
| GraphQL error `"not authorized"`     | User is not a party to this transaction                |
| GraphQL error `"already consented"`  | User already accepted this offer                       |

## Post-action

After a successful accept that results in `status: "complete"`, refetch:

```
league_transactions_filtered(league_id, type_filters: ["trade"])
```

Also refresh the user's roster to reflect the new player assignments.
