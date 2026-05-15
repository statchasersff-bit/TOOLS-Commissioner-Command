# get_dm_by_members

Looks up an existing DM channel between the authenticated user and one other user.
Returns the channel ID (`dm_id`) and optionally read-state metadata.

## Endpoint

```
POST https://sleeper.com/graphql
```

## Headers

```
Content-Type: application/json
authorization: <JWT>                      ← raw token, NO "Bearer" prefix
x-sleeper-graphql-op: get_dm_by_members
```

## Query — slim (dm_id only)

```graphql
query get_dm_by_members {
  get_dm_by_members(members: ["<otherUserId>"]) {
    dm_id
  }
}
```

## Query — full (with read state)

```graphql
query get_dm_by_members {
  get_dm_by_members(members: ["<otherUserId>"]) {
    dm_id
    last_message_id
    last_read_id
  }
}
```

The `members` argument is embedded as a string literal array in the query body —
**not** a GraphQL variable. No variables object is needed.

## Response

```json
{
  "data": {
    "get_dm_by_members": {
      "dm_id": "123456789_987654321",
      "last_message_id": "999888777",
      "last_read_id": "999888777"
    }
  }
}
```

Returns `null` if no DM thread has been started between these two users yet.

```json
{
  "data": {
    "get_dm_by_members": null
  }
}
```

## Response fields

| Field             | Type             | Description                                                   |
|-------------------|------------------|---------------------------------------------------------------|
| `dm_id`           | `string`         | The DM channel ID used in all subsequent message operations   |
| `last_message_id` | `string \| null` | ID of the most recent message in the thread                   |
| `last_read_id`    | `string \| null` | ID of the last message the authenticated user has read        |

### Detecting unread messages

```ts
const hasUnread = !!last_message_id && last_message_id !== last_read_id;
```

### dm_id format

Typically two Sleeper user IDs joined by `_`, but this is not guaranteed. Always treat
`dm_id` as an opaque string.

## No variables

The `members` array is a **string literal** embedded directly in the query. This means
the `otherUserId` must be interpolated into the query string before sending:

```ts
query: `
  query get_dm_by_members {
    get_dm_by_members(members: ["${otherUserId}"]) {
      dm_id
      last_message_id
      last_read_id
    }
  }
`
```

Do not use a `$members` variable — it does not work.

## create_read_receipt (mark as read)

After fetching messages, mark the thread read with a companion operation:

```graphql
query create_receipt {
  create_read_receipt(
    parent_type: "dm",
    parent_id: "<dmId>",
    message_id: "<lastMessageId>"
  )
}
```

Headers: `x-sleeper-graphql-op: create_receipt`

- `parent_id` and `message_id` are string literals in the query body
- This is a query (not mutation) despite being a write operation
- Errors are non-critical — fire-and-forget is safe

## Usage Flow

```
1. get_dm_by_members(otherUserId) → dm_id
2. messages(dm_id) → message list
3. create_read_receipt(dm_id, last_message_id) → mark read
4. create_message(dm_id, text) → send reply
```

## Known Quirks

- Returns `null` (not an error) when no DM thread exists yet between the two users.
  A DM thread is created implicitly on the first `create_message`.
- The `members` array must contain exactly one user ID — the other user (not your own).
  Sleeper infers the authenticated user from the JWT.
- `last_read_id` is per-user and reflects the authenticated user's read cursor only.
- The `dm_id` is stable and does not change even if one user changes their username.

## Failure Cases

| Symptom                              | Likely Cause                               |
|--------------------------------------|--------------------------------------------|
| `data.get_dm_by_members` is `null`   | No DM thread exists yet — will be created on first send |
| HTTP 401                             | Token expired or invalid                   |
| GraphQL error `"invalid user"`       | `otherUserId` does not correspond to a valid Sleeper account |
