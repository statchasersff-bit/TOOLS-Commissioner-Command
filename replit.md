# Dynasty Command Center - StatChasers

## Overview
A premium dynasty fantasy football league analysis tool built with React + TypeScript + Vite. Uses Sleeper API integration for real league data, FantasyCalc for player values, and a two-level tab navigation system (main tabs -> sub tabs).

## Architecture
- **Frontend + Express backend** with Sleeper API proxy and FantasyCalc values
- **SleeperProvider** context manages account connection, league list, active league
- **ValueModelProvider** context drives all value calculations (player values, pick values, team metrics)
- Power Score formula: 0.45 Starter Value + 0.25 Bench Value + 0.20 Picks + 0.10 Youth
- State-based navigation with URL query param persistence (?tab=X&sub=Y)
- localStorage persistence for tab/sub/league ("sc-dynasty-state") and Sleeper connection ("sc-sleeper-connection")
- Two-level tab system: 8 main tabs (Portfolio first), each with 2-3 sub-tabs
- Portfolio tab renders freely; all other tabs locked behind Sleeper connection
- Default state: portfolio:connect

## Sleeper API Integration
- **Backend proxy**: `server/sleeper.ts` handles all Sleeper API calls
- **Endpoints**:
  - `GET /api/sleeper/user/:username` → user lookup
  - `GET /api/sleeper/user/:userId/leagues?season=2025` → league summaries
  - `GET /api/sleeper/league/:leagueId/full?userId=xxx` → full league data transformed to our League/Team format
- **Player DB**: Cached at `/tmp/sleeper_players.json` (24h TTL), maps Sleeper player IDs to metadata
- **Data transform**: Sleeper rosters → our League/Team/Player format with proper starter detection, pick allocation (rounds 1-4, years 2025-2028), and format detection (SF/1QB)
- **Context**: `SleeperContext.tsx` manages connection state with `connect()`, `disconnect()`, `refresh()`, `setActiveLeague()`
- **Auto-reconnect**: On mount, if stored username exists in localStorage, auto-reconnects
- **Season**: Uses 2026 as current season
- **Dynasty filter**: Only shows dynasty leagues (settings.type === 2), excludes redraft/keeper

## Value Source Integration (FantasyCalc)
- **Backend proxy**: `GET /api/values/fantasycalc?format=sf|1qb` proxies and caches FantasyCalc API
- **Daily caching**: File-based cache at `/tmp/fantasycalc_cache_{format}.json`, 24-hour TTL
- **Dev fallback**: Snapshot file at `server/data/fantasycalc_snapshot_sf.json` used when API unreachable
- **Player matching**: Uses sleeperId from FantasyCalc API directly; falls back to name+pos matching
- **Pick values**: Static table in `client/src/data/pickValues.ts` (rounds 1-4, years 2025-2028, early/mid/late tiers)
- **Attribution**: "Values provided by FantasyCalc.com" visible in header when FantasyCalc is active

## Project Structure
```
server/
  index.ts               - Express server setup
  routes.ts              - API routes (FantasyCalc proxy, Sleeper proxy endpoints)
  fantasycalc.ts         - FantasyCalc API fetcher + file cache + snapshot fallback
  sleeper.ts             - Sleeper API proxy (user, leagues, full league transform, player DB cache)
  data/
    fantasycalc_snapshot_sf.json - Dev fallback snapshot of FantasyCalc values

client/src/
  types/index.ts          - TypeScript interfaces (League, Team, Player, Pick, SleeperUser, SleeperLeagueSummary, etc.)
  data/
    mockData.ts           - Nav config (NAV_CONFIG with Portfolio first) + utility functions
    pickValues.ts         - Static pick value table (round × year × projected range)
  contexts/
    ValueModelContext.tsx  - ValueModelProvider with FantasyCalc API fetch, getPlayerValue, getPickValue, calculateMetrics
    SleeperContext.tsx     - SleeperProvider with connect/disconnect/refresh, league list, active league, localStorage persistence
  components/
    MainTabs.tsx           - Top-level tab navigation (rounded-full pills, gold underline)
    SubTabs.tsx            - Second-level tab navigation (rounded-full pills, gold underline)
    LeagueSelector.tsx     - League dropdown selector (pill-style)
    ValueSourceSelector.tsx - Value source dropdown + ValueAttribution component
    KpiCard.tsx            - Metric display cards with skeleton loading + tooltip support
    DataTable.tsx          - Sortable/scrollable data table with skeleton loading, sticky columns
    InsightCallout.tsx     - Positive/neutral/negative insight cards
    SectionHeader.tsx      - Section headers with gold accent bar (text-xl/2xl bold)
    ThemeToggle.tsx        - Dark/light mode toggle
  pages/
    DynastyCommandCenter.tsx - Main page orchestrator (Portfolio integration, locking, Sleeper data flow, header controls)
    tabs/
      Portfolio.tsx        - PortfolioConnect, PortfolioMyLeagues, PortfolioSummary
      Dashboard.tsx        - Overview (with Jump to menu), League Snapshot, Key Insights
      LeagueAnalyzer.tsx   - Power Rankings, Tier Breakdown, Roster Comparison
      TeamBreakdown.tsx    - Roster Strength, Age Curve, Depth Chart
      TradeCenter.tsx      - Trade Finder, Trade Targets, Trade Block Scanner
      DraftCapital.tsx     - Pick Value, Pick Distribution
      LeagueMarket.tsx     - Positional Surplus, Market Value
      Insights.tsx         - Team Insights, League Trends
```

## Value Model
- FantasyCalc (active): fetches real player values from API via backend proxy, cached daily
- KTC, DLF, Custom Upload: listed as "Coming Soon" / disabled
- Value sources: FantasyCalc (active default), KeepTradeCut (Coming Soon), DLF (Coming Soon), Custom Upload (Coming Soon)
- Sleeper roster data enriched with real FantasyCalc values via sleeperId matching
- Switching sources triggers a "Recalculating..." overlay animation

## Branding
- Brand Navy: #0b3a7a
- Brand Gold: #d4af37
- Font: Inter
- Dark mode supported via class toggle
- Gold underline pattern: `<div className="mb-X"><h3>Title</h3><span className="block h-[2.5px] w-10 bg-[#d4af37] rounded-full mt-1.5" /></div>`
- DO NOT use Popover component (causes React dual-instance hook error) — use Tooltip instead

## UX Features
- Portfolio tab is first/default — user connects Sleeper account, browses leagues, views portfolio summary
- Non-portfolio tabs locked with premium-feel card until Sleeper is connected
- Header shows: SC logo, user badge (when connected), league selector, value source selector, share/export buttons, theme toggle
- Sync status badge shows time since last Sleeper data refresh
- FantasyCalc attribution line below header selectors
- Loading overlays for league fetch, value recalculation
- State restored from localStorage on refresh (tab, sub-tab, league, Sleeper connection)

## UI Polish
- Tabs: rounded-full pill shape with gold underline active indicator
- Cards: p-6 padding for breathing room, hover-elevate effect
- Section headers: text-xl/text-2xl font-bold with 3px gold accent bar
- Blueprint background: subtle grid texture on main page (adapts to dark mode)
- Skeleton loading: skeleton-pulse animation for KpiCard and DataTable
- DataTable: sticky first column with proper background inheritance, alternating row colors

## Tech Stack
- React 18 + TypeScript
- Vite dev server + Express backend
- TailwindCSS with shadcn/ui components
- Wouter for routing
- File-based caching for API responses
