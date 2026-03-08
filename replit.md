# Dynasty Command Center - StatChasers

## Overview
Dynasty Command Center is a premium fantasy football league analysis tool designed to provide in-depth insights for dynasty leagues. It integrates with the Sleeper API for real league data and FantasyCalc for player valuations, offering advanced analytics like power rankings, trade evaluations, and player market analysis.

## Architecture
The application is a **fully static React SPA** (no backend required). All external API calls (Sleeper, FantasyCalc) are made directly from the browser. The app can be deployed to any static hosting platform (Cloudflare Pages, Netlify, Vercel, etc.).

**Frontend API Layer:**
- `client/src/lib/sleeperApi.ts` — All Sleeper API calls (user lookup, leagues, league full data, portfolio summary, draft board, live drafts, transactions, cross-league trades)
- `client/src/lib/fantasycalcApi.ts` — FantasyCalc dynasty and redraft value fetching
- Both modules use `localStorage` for caching (24h TTL for player database and values)

**State Management:**
- `SleeperProvider` — Manages Sleeper account connection, league list, active league
- `ValueModelProvider` — Handles all value calculations (player values, pick values, team metrics)
- Navigation state persisted via URL query params and `localStorage`

**Key Files:**
- `client/src/pages/DynastyCommandCenter.tsx` — Main app shell with tab navigation
- `client/src/pages/tabs/` — All tab components (Dashboard, Portfolio, TradeCenter, LiveDraft, Transactions, etc.)
- `client/src/contexts/` — React contexts (SleeperContext, ValueModelContext)
- `client/src/lib/` — API services, utilities
- `client/src/data/` — Static data (pick values, mock data helpers)

## User Preferences
- **Communication Style**: Clear and concise language.
- **Coding Style**: Focus on maintainable and readable code.
- **Branding**: Brand Navy (#0b3a7a), Brand Gold (#d4af37), Inter font
- **Theming**: Dark mode default
- **Avoidances**: No `Popover` component (React hook errors); use `Tooltip` instead. No `useQuery`/`useMutation` from `@tanstack/react-query` (dual React instance issue).

## UI/UX
- Rounded-full pill-shaped tabs with gold underline for active indicators
- Cards with `p-6` padding and hover-elevate effect
- Section headers: bold text with 3px gold accent bar
- Skeleton loading for KPIs and data tables
- Subtle blueprint grid texture background

## Tier Classification System
Teams are classified using a priority-based decision tree in `client/src/data/mockData.ts`:
- **Inputs**: RED (redraft/starter rank), DYN (dynasty/depth rank), PCKS (pick capital rank)
- **Priority order**: Taco → Juggernaut → Future Powerhouse → Pick Hoarder → Win-Now → Contender → Balanced
- **Balanced** is the universal fallback (no N/A tier exists)
- `classifyTeamTier()` returns `TierResult` with `{ tier, tierDescription, debug }` for debugging
- `getLeagueTeamTiers()` returns a Map with `{ tier, tooltip, tierDescription, debug }` per team
- Tier type: `"Juggernaut" | "Win-Now" | "Future Powerhouse" | "Pick Hoarder" | "Taco" | "Contender" | "Balanced"`
- Helper functions: `getTierColor`, `getTierEmoji`, `getTierBg`, `getTierBorderColor`, `getTierTooltip`
- Contender tiers: Juggernaut, Win-Now, Contender; Rebuilder tiers: Future Powerhouse, Pick Hoarder, Taco
- Pick Hoarder requires: top 25% PCKS + bottom 25% RED + bottom 50% DYN (tightened from previous)
- Contender requires: top 33% RED + top 50% DYN (catches strong teams that aren't quite Juggernaut/Win-Now)

## Features
- **Portfolio**: Sleeper account connection, cross-league analysis, player exposure, lineup alerts
- **My Team**: Roster strength, age curve, depth chart
- **League Analyzer**: Power rankings, roster comparison, league intelligence
- **Trade Center**: Trade calculator with position impact analysis, cross-league trade intel
- **Players**: Market value analysis
- **Live Draft**: Dynasty rankings board with Sleeper draft integration

## External APIs & Static Data
- **Sleeper API** (`https://api.sleeper.app/v1/`) — User, leagues, rosters, drafts, transactions (called directly from browser, public CORS-enabled)
- **FantasyCalc Values** — Bundled as static JSON files in `client/src/data/`:
  - `fantasycalc_dynasty_sf.json` — Dynasty superflex values (389 players)
  - `fantasycalc_redraft_sf.json` — Redraft superflex values (199 players)
  - Updated manually; no runtime API calls to FantasyCalc

## Build & Deploy
- Dev: `npm run dev` (starts Express server + Vite for development)
- Static build: `npx tsx script/build-static.ts` — outputs to `dist/public/`
- Base path: `/dynasty-command/launch/` (configured in `vite.config.ts`)
- Bluehost: Upload contents of `dist/public/` to `public_html/dynasty-command/launch/`
- `.htaccess` included in build for Apache SPA routing
- `_redirects` included for Cloudflare Pages SPA routing
- No database required for the static frontend

## Legacy (Server-Side, Not Used in Static Build)
- `server/` directory contains Express routes, Sleeper proxy, FantasyCalc proxy, trade crawler, value snapshots — all superseded by frontend direct API calls
- PostgreSQL database was used for trade database and value snapshots — these features show "Coming Soon" placeholders in the static build
