# create_message

Sends a message to a DM channel. Supports two modes:
1. **Plain text** — a simple text message with no attachment
2. **Trade card** — a rich trade card attachment rendered inline in the Sleeper DM thread

## Endpoint

```
POST https://sleeper.com/graphql
```

## Headers

```
Content-Type: application/json
authorization: <JWT>                      ← raw token, NO "Bearer" prefix
x-sleeper-graphql-op: create_message
```

## Mutation — Plain Text

```graphql
mutation create_message($text: String) {
  create_message(
    parent_id: "<dmId>",
    client_id: "<uuid>",
    parent_type: "dm",
    text: $text
  ) {
    attachment
    author_avatar
    author_display_name
    author_real_name
    author_id
    author_is_bot
    author_role_id
    created
    edited
    message_id
    parent_id
    parent_type
    pinned
    reactions
    user_reactions
    text
    text_map
    client_id
  }
}
```

**Variables:** `{ text: "your message here" }`

## Mutation — Trade Card Attachment

When `attachTradeCard = true`, adds `attachment_type`, `k_attachment_data`, and
`v_attachment_data` to the mutation. The attachment data is passed as parallel key/value
string arrays.

```graphql
mutation create_message(
  $text: String,
  $k_attachment_data: [String],
  $v_attachment_data: [String]
) {
  create_message(
    parent_id: "<dmId>",
    client_id: "<uuid>",
    parent_type: "dm",
    text: $text,
    shard_min: null,
    shard_max: null,
    attachment_type: "trade_dm",
    k_attachment_data: $k_attachment_data,
    v_attachment_data: $v_attachment_data
  ) {
    attachment
    author_avatar
    author_display_name
    author_id
    created
    message_id
    parent_id
    parent_type
    text
    text_map
    user_reactions
    client_id
  }
}
```

**Variables:**

```json
{
  "text": "Check out this trade offer",
  "k_attachment_data": [
    "status",
    "transactions_by_roster",
    "transaction_id",
    "league_id",
    "users_in_league_map"
  ],
  "v_attachment_data": [
    "proposed",
    "{\"3\":{...},\"7\":{...}}",
    "1234567890",
    "<leagueId>",
    "{\"<userId>\":{\"display_name\":\"...\"}}"
  ]
}
```

### Trade card attachment keys

| Key                    | Value                                                       |
|------------------------|-------------------------------------------------------------|
| `status`               | Trade status string, e.g. `"proposed"`                     |
| `transactions_by_roster`| `JSON.stringify(Record<rosterId, transactionObject>)`      |
| `transaction_id`       | The Sleeper transaction ID                                  |
| `league_id`            | The Sleeper league ID                                       |
| `users_in_league_map`  | `JSON.stringify(Record<userId, {display_name, avatar}>)`   |

## client_id

A fresh `crypto.randomUUID()` must be generated on **every call**. Sleeper uses
`client_id` for deduplication — reusing a `client_id` will cause the message to be
silently dropped on retry. This is the primary mechanism for preventing duplicate DMs.

```ts
const clientId = crypto.randomUUID();
```

## Response

```json
{
  "data": {
    "create_message": {
      "message_id": "999888777",
      "parent_id": "<dmId>",
      "parent_type": "dm",
      "author_id": "<userId>",
      "author_display_name": "YourUsername",
      "author_avatar": "abc123",
      "text": "Check out this trade offer",
      "attachment": "{\"type\":\"trade_dm\",\"status\":\"proposed\",...}",
      "created": 1735001000000,
      "client_id": "<uuid>"
    }
  }
}
```

- `attachment` is returned as a **JSON string** (not a parsed object) in some response
  shapes. Always `JSON.parse()` before accessing attachment fields.
- `attachment.type === "trade_dm"` identifies messages with trade card attachments.

## Required Fields

- `parent_id` — the DM channel ID (from `get_dm_by_members`)
- `client_id` — fresh UUID per call
- `parent_type` — always `"dm"` for direct messages
- `text` — can be an empty string `""` but must be present

## Known Quirks

- `parent_id` and `client_id` are embedded as **string literals** in the mutation body,
  not as GraphQL variables.
- `shard_min: null` and `shard_max: null` must be present in the trade card variant or
  Sleeper may reject the mutation.
- For plain text messages (no attachment), omit all of `shard_min`, `shard_max`,
  `attachment_type`, `k_attachment_data`, `v_attachment_data`. Including empty arrays
  for these still renders a trade card UI shell.
- The `attachment` field in the response may be returned as a stringified JSON object —
  parse it before inspecting type.
- Duplicate messages are prevented server-side via `client_id`. Always generate a fresh
  UUID; never cache and reuse one across retries.

## Failure Cases

| Symptom                           | Likely Cause                                      |
|-----------------------------------|---------------------------------------------------|
| `data.create_message` is `null`   | `parent_id` (dmId) does not exist                 |
| HTTP 401                          | Token expired or invalid                          |
| Message silently missing          | Reused `client_id` — server deduplicated it away  |
| Trade card renders empty          | `transactions_by_roster` or `users_in_league_map` malformed JSON |
