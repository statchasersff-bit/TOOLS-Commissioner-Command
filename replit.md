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
- Two-level tab system: 5 main tabs (Portfolio first), each with sub-tabs
- Portfolio tab renders freely; all other tabs locked behind Sleeper connection
- Default state: portfolio:connect

## Tab Navigation Structure
- **Portfolio**: Connect, My Leagues, Portfolio Summary
- **My Team** (id: dashboard): Overview, Roster Strength, Age Curve, Depth Chart
- **League Analyzer**: Power Rankings, Roster Comparison, Key Insights, Pick Distribution, Team Insights, League Trends
- **Trade Center**: Trade Database, Trade Calculator, Trade Finder, Trade Targets, Trade Block Scanner, Positional Surplus
- **Players** (id: league-market): Market Value

## Sleeper API Integration
- **Backend proxy**: `server/sleeper.ts` handles all Sleeper API calls
- **Endpoints**:
  - `GET /api/sleeper/user/:username` → user lookup
  - `GET /api/sleeper/user/:userId/leagues?season=2026` → league summaries
  - `GET /api/sleeper/league/:leagueId/full?userId=xxx` → full league data transformed to our League/Team format
  - `GET /api/sleeper/user/:userId/portfolio-summary` → cross-league portfolio analysis (records, player exposure, lineup alerts)
- **Player DB**: Cached at `/tmp/sleeper_players.json` (24h TTL), maps Sleeper player IDs to metadata
- **Data transform**: Sleeper rosters → our League/Team/Player format with proper starter detection, pick allocation (rounds 1-4, years 2025-2028), and format detection (SF/1QB)
- **Context**: `SleeperContext.tsx` manages connection state with `connect()`, `disconnect()`, `refresh()`, `setActiveLeague()`
- **Auto-reconnect**: On mount, if stored username exists in localStorage, auto-reconnects
- **Season**: Uses 2026 as current season
- **Dynasty filter**: Only shows dynasty leagues (settings.type === 2), excludes redraft/keeper

## Value Source Integration (FantasyCalc)
- **Dynasty values**: `GET /api/values/fantasycalc?format=sf|1qb` — dynasty trade values (isDynasty=true), used for player display values, depth scores, trade analysis, portfolio views
- **Redraft values**: `GET /api/values/fantasycalc/redraft?format=sf|1qb` — redraft rankings (isDynasty=false), used for all competing/contending analysis: starter scores, position scores (qb/rb/wr/te), contender window, and overall power score (which factors starter scores at 45%)
- **Dual-value architecture**: ValueModelContext fetches both dynasty and redraft values in parallel. `getPlayerValue()` returns dynasty values; `getRedraftValue()` returns redraft values. `calculateMetrics()` uses redraft for starters/positions/contending and dynasty for depth/bench
- **Daily caching**: File-based cache at `/tmp/fantasycalc_cache_{format}.json` and `/tmp/fantasycalc_cache_redraft_{format}.json`, 24-hour TTL
- **Dev fallback**: Snapshot file at `server/data/fantasycalc_snapshot_sf.json` used when dynasty API unreachable; redraft gracefully falls back to dynasty values if unavailable
- **Player matching**: Uses sleeperId from FantasyCalc API directly; falls back to name+pos matching
- **Pick values**: Static table in `client/src/data/pickValues.ts` (rounds 1-4, years 2025-2028, early/mid/late tiers)
- **Attribution**: "Values provided by FantasyCalc.com" visible in header when FantasyCalc is active

## Trade Database (Network Crawler)
- **PostgreSQL-backed**: Schema in `shared/schema.ts` with tables: `crawled_leagues`, `crawled_users`, `trades`, `trade_assets`, `crawl_state`, `crawl_queue`
- **Crawler engine**: `server/tradeCrawler.ts` — starts from a Sleeper username, traverses the dynasty league network outward
  - Degree 0: seed user's leagues → Degree 1: leaguemates' leagues → etc. up to maxDegree (4)
  - Each league: traverses season chain (previous_league_id, up to 5 seasons back), fetches transactions rounds 1-18
  - Rate limited: 500ms between Sleeper API calls
  - Stores all completed trades with player names, positions, ages, pick details, and league settings metadata
  - Background process: runs asynchronously, can be paused/resumed
- **API endpoints**:
  - `POST /api/crawler/start` — body: `{ username }` — starts crawl
  - `POST /api/crawler/pause` / `POST /api/crawler/resume` — control crawler
  - `GET /api/crawler/status` — returns crawl progress (trades, leagues, users, degree)
  - `GET /api/trades/search?q=&format=&scoring=&season=&page=&limit=` — paginated trade search with filters
  - `GET /api/trades/stats` — aggregate stats (total trades, leagues, format/scoring/season breakdowns)

## Trade Calculator
- Premium trade evaluation tool in `client/src/pages/tabs/TradeCenter.tsx`
- Two-column trade builder: Side A / Side B with player search + pick picker
- Uses FantasyCalc dynasty values for player valuations, static pick table for picks
- **Value Adjustment** (diminishing returns): weights [1.00, 0.85, 0.72, 0.60, 0.50, 0.42, 0.36, 0.31] applied to sorted asset values
- **Overpay Tax**: optional -3% penalty when top asset > 35% of raw total
- **Fairness badges**: Fair (≤5%), Slight Overpay (5-12%), Overpay (>12%)
- **Position Impact**: shows QB/RB/WR/TE starter value before/after for user's team
- Suggested counter when diff > 12%

## Project Structure
```
server/
  index.ts               - Express server setup
  routes.ts              - API routes (FantasyCalc, Sleeper, crawler, trade search)
  fantasycalc.ts         - FantasyCalc API fetcher + file cache + snapshot fallback
  sleeper.ts             - Sleeper API proxy (user, leagues, full league transform, player DB cache, portfolio summary aggregation)
  tradeCrawler.ts        - Trade network crawler engine (start/pause/resume, queue processing, trade collection)
  data/
    fantasycalc_snapshot_sf.json - Dev fallback snapshot of FantasyCalc values

shared/
  schema.ts              - Drizzle ORM schema (users, crawled_leagues, crawled_users, trades, trade_assets, crawl_state, crawl_queue)

client/src/
  types/index.ts          - TypeScript interfaces (League, Team, Player, Pick, SleeperUser, TradeRecord, TradeSide, CrawlStatus, etc.)
  data/
    mockData.ts           - Nav config (NAV_CONFIG) + utility functions (getPositionColor, getTeamTier, getTierColor, generateInsights with categories)
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
      Portfolio.tsx        - PortfolioConnect, PortfolioMyLeagues, PortfolioSummary (performance records, player exposure, lineup alerts)
      Dashboard.tsx        - Overview (Team Snapshot/Identity cards), DashboardSnapshot (Power Rankings table), DashboardKeyInsights (grouped by category)
      LeagueAnalyzer.tsx   - Roster Comparison
      TeamBreakdown.tsx    - Roster Strength, Age Curve, Depth Chart
      TradeCenter.tsx      - Trade Database, Trade Calculator, Trade Finder, Trade Targets, Trade Block Scanner
      DraftCapital.tsx     - Pick Distribution
      LeagueMarket.tsx     - Positional Surplus, Market Value
      Insights.tsx         - Team Insights, League Trends
```

## Key Insights Categories
Insights are grouped into 5 categories: League Leaders, Draft Capital, Contender Analysis, Trade Opportunities, Your Team. Each has an icon and description header.

## Position Colors
- QB: red, RB: green (emerald), WR: blue, TE: yellow — via `getPositionColor()` in mockData.ts

## Value Model
- FantasyCalc (active): fetches real player values from API via backend proxy, cached daily
- KTC, DLF, Custom Upload: listed as "Coming Soon" / disabled
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
- Portfolio Summary: cross-league performance records, player exposure analysis with overexposure warnings, lineup alerts for empty/OUT/IR starters
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
- Power Rankings: custom table with grouped column headers, rank badges (gold/silver/bronze), power bars, user team highlight

## Tech Stack
- React 18 + TypeScript
- Vite dev server + Express backend
- TailwindCSS with shadcn/ui components
- Wouter for routing
- File-based caching for API responses
