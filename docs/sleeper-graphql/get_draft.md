# get_draft

Fetches full draft state in a single round-trip: draft metadata, all participating
users, and all picks made so far. This is a compound query that resolves three
root fields in one request.

## Endpoint

```
POST https://sleeper.com/graphql
```

## Headers

```
Content-Type: application/json
authorization: <JWT>                      ← raw token, NO "Bearer" prefix
x-sleeper-graphql-op: get_draft
```

## Query

All three root fields (`get_draft`, `user_drafts_by_draft`, `draft_picks`) are fetched
in a single request. `draft_id` is embedded as a string literal — not a variable.

```graphql
query get_draft {
  get_draft(sport: "nfl", draft_id: "<draftId>") {
    created
    draft_id
    draft_order
    last_message_time
    last_message_id
    last_picked
    league_id
    metadata
    season
    season_type
    settings
    sport
    status
    start_time
    type
  }
  user_drafts_by_draft(draft_id: "<draftId>") {
    user_id
    user_display_name
    user_avatar
    user_is_bot
    metadata
  }
  draft_picks(draft_id: "<draftId>") {
    draft_id
    pick_no
    player_id
    picked_by
    is_keeper
    metadata
    reactions
  }
}
```

No variables object is needed — all arguments are string literals.

## Response

### `get_draft`

```json
{
  "draft_id": "987654321",
  "league_id": "<leagueId>",
  "status": "drafting",
  "type": "snake",
  "sport": "nfl",
  "season": "2025",
  "season_type": "regular",
  "start_time": 1735000000000,
  "last_picked": 1735001000000,
  "last_message_time": null,
  "last_message_id": null,
  "created": 1734000000000,
  "draft_order": { "<userId>": 1, "<userId2>": 2 },
  "settings": {
    "teams": 12,
    "rounds": 25,
    "pick_timer": 60,
    "reversal_round": 4
  },
  "metadata": {}
}
```

#### draft_order

`draft_order` is a `Record<userId, slotNumber>` where slot is **1-indexed**:

```json
{ "userId_A": 1, "userId_B": 2, "userId_C": 3 }
```

Invert to get `slotToUser` map for display purposes.

#### settings fields

| Field            | Description                                           |
|------------------|-------------------------------------------------------|
| `teams`          | Number of teams in the draft                          |
| `rounds`         | Total rounds                                          |
| `pick_timer`     | Seconds per pick; `0` = no timer                      |
| `reversal_round` | Round where order reverses in snake drafts            |

#### status values

| Value       | Meaning                              |
|-------------|--------------------------------------|
| `pre_draft` | Draft scheduled but not started      |
| `drafting`  | Draft actively in progress           |
| `complete`  | All picks made, draft concluded      |

### `user_drafts_by_draft`

Array of all managers in the draft:

```json
[
  {
    "user_id": "<userId>",
    "user_display_name": "ManagerName",
    "user_avatar": "abc123",
    "user_is_bot": false,
    "metadata": {}
  }
]
```

Build avatar URLs: `https://sleepercdn.com/avatars/thumbs/<user_avatar>`

### `draft_picks`

Array of all picks made so far, unsorted:

```json
[
  {
    "draft_id": "987654321",
    "pick_no": 1,
    "player_id": "4035",
    "picked_by": "<userId>",
    "is_keeper": false,
    "metadata": {
      "player_name": "Patrick Mahomes",
      "first_name": "Patrick",
      "last_name": "Mahomes",
      "position": "QB",
      "team": "KC"
    },
    "reactions": null
  }
]
```

Sort by `pick_no` ascending for display order.

#### pick_no calculation

```
pick_no = (round - 1) * teams + slot
```

For example in a 12-team draft: pick_no 13 = round 2, slot 1.

## Normalized DraftState

After fetching, normalize into a `DraftState` object:

```ts
interface DraftState {
  draftId: string;
  leagueId: string;
  name: string;
  status: "pre_draft" | "drafting" | "complete";
  season: string;
  type: string;
  teams: number;
  rounds: number;
  pickTimer: number;           // seconds; 0 = no timer
  startTime: number | null;    // ms timestamp
  lastPicked: number | null;   // ms timestamp of most recent pick
  draftOrderByUserId: Record<string, number>;  // userId → 1-indexed slot
  usersById: Record<string, DraftUser>;
  picks: DraftPickNormalized[];
}
```

## Current pick calculation

```ts
const currentPickNo = picks.length + 1;
const currentRound = Math.ceil(currentPickNo / teams);
const slotInRound = ((currentPickNo - 1) % teams) + 1;

// Snake: reverse odd rounds (1-indexed)
const isReversed = currentRound % 2 === 0;
const slot = isReversed ? teams - slotInRound + 1 : slotInRound;

// Find the userId for this slot
const onTheClockUserId = Object.keys(draftOrderByUserId)
  .find(uid => draftOrderByUserId[uid] === slot);
```

## Known Quirks

- All three root fields (`get_draft`, `user_drafts_by_draft`, `draft_picks`) must be
  fetched in a single query. Separate requests are unnecessary and slower.
- `draft_id` is a string literal inside each root field — not a shared variable.
  Interpolate it three times in the same query string.
- `sport: "nfl"` must be passed to `get_draft(...)` — it is required and must be
  the literal string `"nfl"`.
- `draft_picks` are returned in **unspecified order** — sort by `pick_no` ascending.
- Player metadata (`player_name`, `position`, `team`) is embedded in the pick's
  `metadata` object — not looked up via the player database. Use `metadata.player_name`
  before falling back to `metadata.first_name + metadata.last_name`.
- `last_picked` reflects the timestamp of the most recent pick (in ms) — use this to
  calculate time elapsed since the last pick for timer display.
- The `x-sleeper-graphql-op` header must be `"get_draft"` even though the query body
  also resolves `user_drafts_by_draft` and `draft_picks`.

## Polling

For live drafts, poll `get_draft` on an interval (e.g. every 5–10 seconds) to detect
new picks. Compare `picks.length` or `last_picked` against the previous state to
determine if a new pick was made.

## Failure Cases

| Symptom                         | Likely Cause                                    |
|---------------------------------|-------------------------------------------------|
| `data.get_draft` is `null`      | Invalid `draft_id` or draft not found           |
| `draft_picks` is `[]`           | Draft has not started yet (`pre_draft`)         |
| HTTP 401                        | Token expired or invalid                        |
| GraphQL error `"draft not found"`| Draft ID incorrect or deleted                  |
