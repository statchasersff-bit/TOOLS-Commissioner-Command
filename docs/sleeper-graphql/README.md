# Sleeper GraphQL — Internal SDK Documentation

Reverse-engineered documentation for `https://sleeper.com/graphql` — the authenticated
GraphQL endpoint powering the Sleeper web app. All operations here have been confirmed
working in production.

## Transport

All requests share the same transport shape:

```
POST https://sleeper.com/graphql
Content-Type: application/json
authorization: <JWT>                     ← raw token, NO "Bearer" prefix
x-sleeper-graphql-op: <operationName>
```

Body:
```json
{
  "operationName": "<operationName>",
  "query": "...",
  "variables": {}
}
```

**Critical quirks that apply everywhere:**
- `authorization` header has **no `Bearer ` prefix** — just the raw JWT string
- `x-sleeper-graphql-op` must match the operation name exactly (including case — see `reject_trade` below)
- Many operations embed `league_id`, `draft_id`, `parent_id`, etc. as **string literals** in the query body rather than GraphQL variables

---

## Operations

| File | Operation | Type | Auth | Writes |
|------|-----------|------|------|--------|
| [propose_trade.md](./propose_trade.md) | `propose_trade` | mutation | ✅ | ✅ |
| [accept_trade.md](./accept_trade.md) | `accept_trade` | mutation | ✅ | ✅ |
| [reject_trade.md](./reject_trade.md) | `RejectTrade` | mutation | ✅ | ✅ |
| [create_message.md](./create_message.md) | `create_message` | mutation | ✅ | ✅ |
| [messages.md](./messages.md) | `messages` | query | ✅ | ❌ |
| [get_dm_by_members.md](./get_dm_by_members.md) | `get_dm_by_members` | query | ✅ | ❌ |
| [update_draft_queue.md](./update_draft_queue.md) | `update_draft_queue` | mutation | ✅ | ✅ |
| [get_draft.md](./get_draft.md) | `get_draft` | query | ✅ | ❌ |

---

## Known Global Quirks

### Case inconsistency on reject_trade

The `x-sleeper-graphql-op` header for rejecting a trade is **`"RejectTrade"`**
(PascalCase), while every other operation uses `snake_case`. This is a confirmed
quirk in Sleeper's routing — using lowercase `"reject_trade"` may fail silently.

### Literal interpolation vs. variables

Several operations require key arguments as string literals inside the query body
rather than as `$variable` declarations. Confirmed literal-only args:

| Operation | Literal args |
|-----------|--------------|
| `propose_trade` | `league_id`, `draft_picks`, `expires_at`, `reject_transaction_id` |
| `accept_trade` | `league_id` |
| `reject_trade` | `league_id` |
| `get_dm_by_members` | `members` array |
| `create_message` | `parent_id`, `client_id` |
| `messages` | `parent_id` |
| `get_draft` | `draft_id` (in all 3 sub-queries), `sport` |
| `create_read_receipt` | `parent_type`, `parent_id`, `message_id` |

### draft_picks CSV format

Draft picks in `propose_trade` are passed as a JSON-serialised array of CSV strings:

```
"<originalRosterId>,<season>,<round>,<ownerRosterId>,<previousOwnerRosterId>"
```

### Timestamps

All Sleeper timestamps are Unix milliseconds (not seconds), **except**:
- `propose_trade` `expires_at` argument → Unix **seconds**
- `get_draft` `start_time` / `last_picked` → milliseconds

---

## Not Yet Discovered

These operations are referenced in the codebase but their exact mutation shapes have
not been captured from live traffic:

| Operation | Notes |
|-----------|-------|
| `submit_lineup` | Set starting lineup |
| `send_message` | League chat (not DM) |
| `draft_pick` | Make a pick during live draft |
| `roster_update_reserve` | IR / taxi slot moves |

To discover: open browser DevTools → Network tab → filter to `sleeper.com/graphql` →
perform the action in Sleeper web app → inspect the `x-sleeper-graphql-op` header and
request body.
