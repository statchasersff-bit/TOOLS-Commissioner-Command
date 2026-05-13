# Sleeper Auth & GraphQL Discovery Notes

Confirmed endpoints, request shapes, and response shapes discovered from the Sleeper web app.  
Fill in any remaining blanks in `client/src/config/sleeperAuthEndpoints.ts`.

---

## Status

| Endpoint | Status |
|---|---|
| `login_context_by_email_or_phone_or_username` | Confirmed |
| `create_verification_code` | Confirmed |
| `login` (OTP / password) | Confirmed |
| `league_transactions_filtered` | Confirmed |
| hCaptcha site key | **Pending** — see discovery steps below |

---

## GraphQL Endpoints

| Purpose | URL |
|---|---|
| Auth operations (login context, send code, login) | `https://api.sleeper.app/graphql` |
| Authenticated read/action operations | `https://sleeper.com/graphql` |

---

## 1. Login Context

**Endpoint:** `https://api.sleeper.app/graphql`  
**Method:** POST  
**Auth required:** No  

**Query:**
```graphql
query login_context($email_or_phone_or_username: String!) {
  login_context_by_email_or_phone_or_username(
    email_or_phone_or_username: $email_or_phone_or_username
  ) {
    display
    has_password
  }
}
```

**Variables:**
```json
{ "email_or_phone_or_username": "<identifier>" }
```

**Response shape:**
```json
{
  "data": {
    "login_context_by_email_or_phone_or_username": {
      "display": "...",
      "has_password": true
    }
  }
}
```

---

## 2. Create Verification Code (OTP)

**Endpoint:** `https://api.sleeper.app/graphql`  
**Method:** POST  
**Auth required:** No  

**Mutation:**
```graphql
mutation create_verification_code($email_or_phone_or_username: String!) {
  create_verification_code(
    email_or_phone_or_username: $email_or_phone_or_username
  )
}
```

**Variables:**
```json
{ "email_or_phone_or_username": "<identifier>" }
```

**Response:** Returns `true` on success.

---

## 3. Login (OTP or password + hCaptcha)

**Endpoint:** `https://api.sleeper.app/graphql`  
**Method:** POST  
**Auth required:** No (returns a token on success)  

**Query:**
```graphql
query login(
  $email_or_phone_or_username: String!
  $password: String!
  $captcha: String
) {
  login(
    email_or_phone_or_username: $email_or_phone_or_username
    password: $password
    captcha: $captcha
  ) {
    token
  }
}
```

**Variables:**
```json
{
  "email_or_phone_or_username": "<identifier>",
  "password": "<otp_code_or_password>",
  "captcha": "<hcaptcha_token>"
}
```

> `password` accepts either the user's account password or the OTP code sent via `create_verification_code`.  
> `captcha` is required — this is an hCaptcha token. See "Finding the hCaptcha Site Key" below.

**Response shape:**
```json
{
  "data": {
    "login": {
      "token": "<jwt>"
    }
  }
}
```

The JWT is decoded client-side (`atob`) to extract `user_id`, `username`, `avatar`, and `exp`.  
**Never log the token, password, captcha token, or OTP.**

---

## 4. League Transactions Filtered

**Endpoint:** `https://sleeper.com/graphql`  
**Method:** POST  
**Auth required:** Yes — `Authorization: Bearer <token>` header  

**Query:**
```graphql
query league_transactions_filtered(
  $league_id: String!
  $type_filters: [String]
  $leg_filters: [Int]
  $status_filters: [String]
) {
  league_transactions_filtered(
    league_id: $league_id
    type_filters: $type_filters
    leg_filters: $leg_filters
    status_filters: $status_filters
  ) {
    transaction_id
    type
    status
    leg
    roster_ids
    adds
    drops
    waiver_bid
    settings
    metadata
    consenter_ids
    created
    updated
    draft_picks {
      season
      round
      roster_id
      previous_owner_id
      owner_id
    }
  }
}
```

**Variables:**
```json
{
  "league_id": "<league_id>",
  "type_filters": ["trade"],
  "leg_filters": null,
  "status_filters": ["complete"]
}
```

**Filter values (known):**
- `type_filters`: `"trade"`, `"waiver"`, `"free_agent"` (pass `null` for all)
- `leg_filters`: array of week integers, e.g. `[1, 2, 3]` (pass `null` for all weeks)
- `status_filters`: `"complete"`, `"failed"` (pass `null` for all statuses)

**Response shape:**
```json
{
  "data": {
    "league_transactions_filtered": [
      {
        "transaction_id": "...",
        "type": "trade",
        "status": "complete",
        "leg": 5,
        "roster_ids": [1, 3],
        "adds": { "<player_id>": 1, "<player_id>": 3 },
        "drops": { "<player_id>": 3, "<player_id>": 1 },
        "draft_picks": [],
        "waiver_bid": null,
        "consenter_ids": [1, 3],
        "created": 1700000000000,
        "updated": 1700000000000
      }
    ]
  }
}
```

**Implemented in:** `fetchLeagueTransactionsFiltered()` in `client/src/services/sleeperAuthedApi.ts`

---

## Finding the hCaptcha Site Key

The `SLEEPER_HCAPTCHA_SITE_KEY` in `client/src/config/sleeperAuthEndpoints.ts` is currently blank.

**To discover it:**

1. Open Chrome DevTools on `https://sleeper.com`
2. Go to **Sources** → Search (Ctrl+Shift+F) for `sitekey` or `hcaptcha`
3. Or in the **Network** tab during login, look for a request to `hcaptcha.com` — the `sitekey` query param in that URL is the site key
4. It will be a UUID-style string like `a1b2c3d4-e5f6-...`
5. Paste it into `SLEEPER_HCAPTCHA_SITE_KEY` in the config file

---

## Security Rules

- **NEVER** paste real tokens, OTP codes, or credentials into this document.
- Replace all sensitive values with `<placeholder>` or `"..."`.
- Do not commit real tokens to version control.
- Treat discovered endpoints as internal — do not publish them publicly.
