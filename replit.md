# Dynasty Command Center - StatChasers

## Overview
A premium dynasty fantasy football league analysis tool built with React + TypeScript + Vite. Uses a two-level tab navigation system (main tabs -> sub tabs) with mock data ready to be wired to Sleeper API.

## Architecture
- **Frontend + Express backend** with mock roster data and real FantasyCalc values
- **ValueModelProvider** context drives all value calculations (player values, pick values, team metrics)
- Power Score formula: 0.45 Starter Value + 0.25 Bench Value + 0.20 Picks + 0.10 Youth
- State-based navigation with URL query param persistence (?tab=X&sub=Y)
- localStorage persistence for tab, sub-tab, and league selection (key: "sc-dynasty-state")
- Two-level tab system: 7 main tabs, each with 2-3 sub-tabs
- Empty state landing until league is selected; first selection lands on Dashboard > Overview

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
  routes.ts              - API routes (FantasyCalc proxy endpoint)
  fantasycalc.ts         - FantasyCalc API fetcher + file cache + snapshot fallback
  data/
    fantasycalc_snapshot_sf.json - Dev fallback snapshot of FantasyCalc values

client/src/
  types/index.ts          - TypeScript interfaces (League, Team, Player, Pick, ValueSourceId, etc.)
  data/
    mockData.ts           - Mock league data generator + nav config + utility functions
    pickValues.ts         - Static pick value table (round × year × projected range)
  contexts/
    ValueModelContext.tsx  - ValueModelProvider with FantasyCalc API fetch, getPlayerValue, getPickValue, calculateMetrics
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
    DynastyCommandCenter.tsx - Main page orchestrator (blueprint-bg, value model wiring)
    tabs/
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
- Mock roster data is enriched with real FantasyCalc values via name+sleeperId matching
- Switching sources triggers a "Recalculating..." overlay animation

## Branding
- Brand Navy: #0b3a7a
- Brand Gold: #d4af37
- Font: Inter
- Dark mode supported via class toggle

## UX Features
- Header control panel: League selector + Value Source selector with labels, pill-style dropdowns
- FantasyCalc attribution line below header selectors when FantasyCalc is active
- Loading state with spinner when fetching values
- Snapshot (dev) badge when using fallback data
- "Jump to" mini menu on Dashboard Overview links to Snapshot and Key Insights sub-tabs
- KPI cards support "?" tooltip icons explaining what each metric means
- Value Source selector has "?" tooltip explaining the active source
- State restored from localStorage on refresh (tab, sub-tab, league)

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
