# update_draft_queue

Replaces the authenticated user's draft queue with a new ordered list of player IDs.
This is a **full replace** — the entire queue is overwritten with every call.

## Endpoint

```
POST https://sleeper.com/graphql
```

## Headers

```
Content-Type: application/json
authorization: <JWT>                      ← raw token, NO "Bearer" prefix
x-sleeper-graphql-op: update_draft_queue
```

## Mutation

```graphql
mutation update_draft_queue($draft_id: ID!, $player_ids: [String!]!) {
  update_draft_queue(player_ids: $player_ids, draft_id: $draft_id)
}
```

Both `draft_id` and `player_ids` are proper GraphQL variables.

## Variables

| Variable     | Type        | Description                                                       |
|--------------|-------------|-------------------------------------------------------------------|
| `draft_id`   | `ID!`       | The Sleeper draft ID                                              |
| `player_ids` | `[String!]!`| Ordered array of player IDs (index 0 = top of queue)             |

## Response

Returns the updated queue as a flat array of player ID strings:

```json
{
  "data": {
    "update_draft_queue": ["4035", "6797", "7564", "5844"]
  }
}
```

The returned array reflects the server-confirmed queue state after the write.

## Semantics

- **Full replace**: the server discards the previous queue and sets it to exactly
  `player_ids`. There is no "append" or "remove single" operation.
- **Order matters**: index 0 is the highest-priority pick.
- **Empty array clears the queue**: sending `player_ids: []` removes all queued players.

## Helper Patterns

### Add a player to queue

```ts
async function addToQueue(token, draftId, currentQueue, playerId) {
  if (currentQueue.includes(playerId)) return currentQueue;   // idempotent
  return updateDraftQueue(token, draftId, [...currentQueue, playerId]);
}
```

### Remove a player from queue

```ts
async function removeFromQueue(token, draftId, currentQueue, playerId) {
  return updateDraftQueue(
    token,
    draftId,
    currentQueue.filter(id => id !== playerId)
  );
}
```

### Reorder (drag-and-drop)

```ts
// Move player from index `from` to index `to`
function reorder(queue, from, to) {
  const next = [...queue];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
// Then call updateDraftQueue with the reordered array
```

## Related: draft_queue (read)

Fetch the current queue before any write to avoid clobbering concurrent changes:

```graphql
query draft_queue($draft_id: ID!) {
  draft_queue(draft_id: $draft_id)
}
```

Headers: `x-sleeper-graphql-op: draft_queue`

Variables: `{ draft_id: "<draftId>" }`

Returns the same flat `string[]` format.

## Known Quirks

- **Always send the full array.** Sending a partial list truncates the queue. Fetch
  the current queue first with `draft_queue`, mutate it client-side, then write back
  the full result.
- The `player_ids` argument name in the mutation body is `player_ids`, but the
  variable declaration uses `$player_ids` — both are snake_case (consistent).
- Queued players that have already been drafted are silently ignored by the server.
  The returned array may therefore be shorter than what was sent if picks were made
  during the request.
- Queue state is **per-user** — each manager has their own queue for the same draft.
  Other managers cannot see or modify your queue.
- The queue is only used when autopick is enabled for that slot, or when the live
  draft room auto-picks on timer expiry.

## Failure Cases

| Symptom                                    | Likely Cause                                       |
|--------------------------------------------|----------------------------------------------------|
| `data.update_draft_queue` is `null`        | Draft ID is invalid or draft has not started       |
| Returned array shorter than sent           | Some players in `player_ids` already drafted       |
| HTTP 401                                   | Token expired or invalid                           |
| GraphQL error `"draft not found"`          | Invalid `draft_id`                                 |
| GraphQL error `"not authorized"`           | Authenticated user is not in this draft            |
