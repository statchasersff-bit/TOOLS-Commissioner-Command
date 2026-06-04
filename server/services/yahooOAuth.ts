/**
 * Yahoo OAuth 2.0 (server-side authorization-code flow) helper.
 *
 * Docs: https://developer.yahoo.com/oauth2/guide/flows_authcode/
 *
 * Required env:
 *   YAHOO_CLIENT_ID      — app key
 *   YAHOO_CLIENT_SECRET  — app secret
 *   YAHOO_REDIRECT_URI   — must EXACTLY match the redirect registered with Yahoo
 */

const AUTHORIZE_URL = "https://api.login.yahoo.com/oauth2/request_auth";
const TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token";

// Read-only Fantasy Sports scope. Phase 1 never requests write scope.
const FANTASY_READ_SCOPE = "fspt-r";

export interface YahooTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  token_type: string;
  xoauth_yahoo_guid?: string;
}

export function isYahooConfigured(): boolean {
  return Boolean(
    process.env.YAHOO_CLIENT_ID && process.env.YAHOO_CLIENT_SECRET && process.env.YAHOO_REDIRECT_URI,
  );
}

function requireConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.YAHOO_CLIENT_ID;
  const clientSecret = process.env.YAHOO_CLIENT_SECRET;
  const redirectUri = process.env.YAHOO_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Yahoo OAuth is not configured (YAHOO_CLIENT_ID/SECRET/REDIRECT_URI).");
  }
  return { clientId, clientSecret, redirectUri };
}

/** Build the Yahoo consent URL the user is redirected to. `state` is CSRF protection. */
export function getAuthorizeUrl(state: string): string {
  const { clientId, redirectUri } = requireConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: FANTASY_READ_SCOPE,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

async function postToken(body: URLSearchParams): Promise<YahooTokenResponse> {
  const { clientId, clientSecret } = requireConfig();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Yahoo token endpoint ${res.status}: ${text.slice(0, 300)}`);
  }
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Yahoo token endpoint returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (!json.access_token || !json.refresh_token) {
    throw new Error("Yahoo token response missing access_token/refresh_token");
  }
  return json as YahooTokenResponse;
}

/** Exchange an authorization code (from the callback) for tokens. */
export async function exchangeCodeForTokens(code: string): Promise<YahooTokenResponse> {
  const { redirectUri } = requireConfig();
  return postToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    }),
  );
}

/** Use a refresh token to mint a fresh access token. */
export async function refreshAccessToken(refreshToken: string): Promise<YahooTokenResponse> {
  const { redirectUri } = requireConfig();
  return postToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      redirect_uri: redirectUri,
      refresh_token: refreshToken,
    }),
  );
}
