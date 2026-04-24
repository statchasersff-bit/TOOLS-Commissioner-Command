const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) || "";
export const API_BASE = base.replace(/\/$/, "");
