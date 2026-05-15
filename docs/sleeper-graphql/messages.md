# messages (fetchDmMessages)

Fetches all messages in a DM channel. Returns messages in insertion order (oldest first
after client-side sort by `created`).

## Endpoint

```
POST https://sleeper.com/graphql
```

## Headers

```
Content-Type: application/json
authorization: <JWT>                      ← raw token, NO "Bearer" prefix
x-sleeper-graphql-op: messages
```

## Query

`parent_id` is embedded as a string literal in the query body — not a GraphQL variable.

```graphql
query messages {
  messages(parent_id: "<dmId>") {
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
  }
}
```

No variables are required. `parent_id` is a literal in the query string.

## Response

```json
{
  "data": {
    "messages": [
      {
        "message_id": "999888777",
        "parent_id": "<dmId>",
        "parent_type": "dm",
        "author_id": "<userId>",
        "author_display_name": "Username",
        "author_avatar": "abc123",
        "author_real_name": null,
        "author_is_bot": false,
        "author_role_id": null,
        "text": "Hey, want to trade?",
        "text_map": null,
        "attachment": null,
        "created": 1735001000000,
        "edited": null,
        "pinned": false,
        "reactions": null,
        "user_reactions": null
      }
    ]
  }
}
```

## Message fields

| Field                  | Type               | Description                                        |
|------------------------|--------------------|----------------------------------------------------|
| `message_id`           | `string`           | Unique message ID                                  |
| `parent_id`            | `string`           | DM channel ID                                      |
| `parent_type`          | `string`           | Always `"dm"` for DM threads                       |
| `author_id`            | `string`           | Sleeper user ID of the sender                      |
| `author_display_name`  | `string`           | Display name at time of send                       |
| `author_avatar`        | `string \| null`   | Avatar hash; build URL: `sleepercdn.com/avatars/thumbs/<hash>` |
| `author_real_name`     | `string \| null`   | Real name if set, often null                       |
| `author_is_bot`        | `boolean`          | True for automated/bot messages                    |
| `author_role_id`       | `string \| null`   | Role ID, usually null in DMs                       |
| `text`                 | `string \| null`   | Message text; null for attachment-only messages    |
| `text_map`             | `object \| null`   | Rich text map; usually null for plain messages     |
| `attachment`           | `object \| null`   | Attachment data; see below                         |
| `created`              | `number`           | Unix timestamp in **milliseconds**                 |
| `edited`               | `number \| null`   | Edit timestamp in ms; null if never edited         |
| `pinned`               | `boolean`          | Whether the message is pinned                      |
| `reactions`            | `object \| null`   | Emoji reaction counts                              |
| `user_reactions`       | `object \| null`   | Per-user reaction map                              |

## attachment field

When a message contains a trade card (`attachment_type: "trade_dm"`):

```json
{
  "type": "trade_dm",
  "status": "proposed",
  "transaction_id": "1234567890",
  "league_id": "<leagueId>",
  "transactions_by_roster": "{...}",
  "users_in_league_map": "{...}"
}
```

- Detect trade cards with: `attachment?.type === "trade_dm"`
- `transactions_by_roster` and `users_in_league_map` are nested JSON strings — parse
  them separately if needed.

## Sort order

Messages are returned in **unspecified order** from the API. Always sort client-side:

```ts
const sorted = [...msgs].sort((a, b) => a.created - b.created);
```

## Read receipts

After fetching messages, mark the thread as read by calling `create_read_receipt`:

```graphql
query create_receipt {
  create_read_receipt(
    parent_type: "dm",
    parent_id: "<dmId>",
    message_id: "<lastMessageId>"
  )
}
```

(`x-sleeper-graphql-op: create_receipt`)

Pass the `last_message_id` from `get_dm_by_members` as the `message_id` to mark up to
that point as read.

## Known Quirks

- `parent_id` must be a string literal in the query body — passing it as a variable
  (`$parent_id: String!`) does not work.
- The API returns up to ~50 recent messages. There is no pagination parameter discovered
  yet; older messages may be truncated.
- `created` is in **milliseconds** (consistent with other Sleeper timestamps).
- `attachment` may be returned as a parsed object or a stringified JSON object depending
  on the Sleeper server version. Defensive handling:
  ```ts
  const att = typeof msg.attachment === "string"
    ? JSON.parse(msg.attachment)
    : msg.attachment;
  ```

## Failure Cases

| Symptom                       | Likely Cause                                  |
|-------------------------------|-----------------------------------------------|
| `data.messages` is `null`     | `parent_id` (dmId) does not exist             |
| `data.messages` is `[]`       | No messages in thread yet                     |
| HTTP 401                      | Token expired or invalid                      |
