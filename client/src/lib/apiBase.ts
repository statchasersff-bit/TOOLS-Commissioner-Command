// VITE_API_BASE_URL points the production Pages build at the Replit API origin.
// In dev the API is served from the same Express process as the Vite middleware,
// so an absolute base URL would route requests away from the local server to
// a (potentially stale) production deployment — and the SPA catch-all there
// returns index.html for unknown /api paths, which the client surfaces as
// "Server returned a non-JSON response". Forcing the base to "" in dev keeps
// requests on the same origin.
const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined) || "";
export const API_BASE = import.meta.env.DEV ? "" : raw.replace(/\/$/, "");
