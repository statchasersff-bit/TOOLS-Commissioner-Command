// VITE_API_BASE_URL points the production Pages build at the Replit API origin.
// In dev the API is served from the same Express process as the Vite middleware,
// so an absolute base URL would route requests away from the local server to
// a (potentially stale) production deployment — and the SPA catch-all there
// returns index.html for unknown /api paths, which the client surfaces as
// "Server returned a non-JSON response". Forcing the base to "" in dev keeps
// requests on the same origin.
function resolveApiBase(): string {
  if (import.meta.env.DEV) return "";

  // If an explicit override is configured (Cloudflare Pages build var, etc.), use it.
  const explicit = (import.meta.env.VITE_API_BASE_URL as string | undefined) || "";
  if (explicit) return explicit.replace(/\/$/, "");

  // No explicit override: use a relative base only when the page itself is
  // being served from the Replit app domain. On any other origin (statchasers.com,
  // dynastycommandff.com, localhost static previews) relative /api/* calls would
  // hit the static file host — which has no Express backend — and 404. Fall back
  // to the canonical Replit API origin so those builds work without needing a
  // rebuild every time the domain changes.
  if (typeof window !== "undefined" && !window.location.hostname.endsWith("replit.app")) {
    return "https://commissioner-command.replit.app";
  }

  return "";
}

export const API_BASE = resolveApiBase();
