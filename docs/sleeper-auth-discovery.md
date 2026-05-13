# Sleeper Auth Endpoint Discovery Guide

Use this guide to discover the exact endpoint URLs, request shapes, and response shapes for Sleeper's authenticated API. Once discovered, fill in the empty strings in `client/src/config/sleeperAuthEndpoints.ts`.

---

## Setup

1. Open Chrome (or Edge) and navigate to the Sleeper web app: https://sleeper.com
2. Open DevTools: `F12` → **Network** tab
3. Check **Preserve log**
4. Filter by **Fetch/XHR**

---

## Discovery Workflow

### Step 1 — Authentication endpoints

Log in via the Sleeper web or mobile app while watching the network tab.

Filter by these terms one at a time:
- `auth`
- `login`
- `token`
- `code`
- `user`
- `session`
- `verify`

For each request, record:

| Field | Value |
|---|---|
| Method | GET / POST / PUT |
| Full URL | `https://api.sleeper.app/...` |
| Request body shape | `{ identifier: "", code: "" }` etc. |
| Auth header format | `Bearer <token>`, cookie, etc. |
| Response body shape | `{ token: "", user_id: "", username: "" }` etc. |
| Token expiration behavior | Does `expires_at` appear in the response? |
| CORS behavior | Does the browser block it? Preflight? |

---

### Step 2 — Action / write endpoints

Once logged in, perform common actions in the Sleeper app:

| Action | Filter term | Expected method |
|---|---|---|
| Set a starting lineup | `lineup`, `roster`, `transaction` | PUT / PATCH |
| Submit a waiver claim | `waiver`, `transaction` | POST |
| Propose a trade | `trade`, `transaction` | POST |
| Accept / reject a trade | `trade`, `transaction` | POST / PATCH |
| Make a draft pick | `draft`, `pick` | POST |
| Send league chat message | `chat`, `message`, `comment` | POST |

For each action endpoint, record the same fields as Step 1.

---

## Recording Template

Copy this block for each discovered endpoint:

```
Endpoint: <auth|action>.<key>
Method:   POST
URL:      /v1/...
Headers:
  Content-Type: application/json
  Authorization: Bearer <token>   (or none for code request)
Request body:
  {
    "field": "<placeholder>",
    ...
  }
Response body:
  {
    "token": "<placeholder>",
    "user_id": "<placeholder>",
    ...
  }
Expiration: <yes/no> — field name if yes
CORS: <preflight required / open / blocked>
Notes: <any quirks>
```

---

## Security Rules

- **NEVER** paste real tokens or credentials into this document.
- Replace all sensitive values with `<placeholder>` or `"..."`.
- Do not commit real tokens to version control.
- Treat discovered endpoints as internal — do not publish them publicly.

---

## Filling in the Config

Once you have verified an endpoint, update the corresponding key in:

```
client/src/config/sleeperAuthEndpoints.ts
```

Example (do not fill in until verified):

```ts
export const SLEEPER_AUTH_ENDPOINTS = {
  requestCode: "/v1/auth/request_code",   // ← fill in after discovery
  verifyCode:  "/v1/auth/verify_code",
  login:       "/v1/auth/login",
  ...
};
```

After updating the config, the `Send Code` button and all write-action helpers in `sleeperAuthedApi.ts` will automatically become active — no other code changes required.

---

## Testing Authentication

After configuring at least `login` or `verifyCode`:

1. Go to the Portfolio → Connect tab in Dynasty Command
2. Use **Send Code** or **Use token manually** to authenticate
3. Verify the "Authenticated" badge appears in the Connect Sleeper card
4. Check `localStorage` key `statchasers_sleeper_auth` in DevTools → Application → Local Storage

---

## Mobile App Token Extraction (alternative)

If the web app uses HTTPS cert pinning or obfuscates the auth flow:

1. Use an Android emulator with a proxy (e.g. Charles Proxy) or a rooted device
2. Install the Sleeper APK
3. Log in and inspect the HTTP traffic
4. The auth token will appear in an `Authorization` header on API requests

Again, never save real tokens to this file.
