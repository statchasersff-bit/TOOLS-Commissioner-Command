# Dynasty Command Center - StatChasers

## Overview
A premium dynasty fantasy football league analysis tool built with React + TypeScript + Vite. Uses a two-level tab navigation system (main tabs -> sub tabs) with mock data ready to be wired to Sleeper API.

## Architecture
- **Frontend-only MVP** with mock data (no database needed yet)
- State-based navigation with URL query param persistence (?tab=X&sub=Y)
- Two-level tab system: 7 main tabs, each with 2-3 sub-tabs

## Project Structure
```
client/src/
  types/index.ts          - TypeScript interfaces (League, Team, Player, Pick, etc.)
  data/mockData.ts        - Mock league data generator + nav config + utility functions
  components/
    MainTabs.tsx           - Top-level tab navigation
    SubTabs.tsx            - Second-level tab navigation
    LeagueSelector.tsx     - League dropdown selector
    KpiCard.tsx            - Metric display cards
    DataTable.tsx          - Sortable/scrollable data table
    InsightCallout.tsx     - Positive/neutral/negative insight cards
    SectionHeader.tsx      - Section headers with gold underline
    ThemeToggle.tsx        - Dark/light mode toggle
  pages/
    DynastyCommandCenter.tsx - Main page orchestrator
    tabs/
      Dashboard.tsx        - Overview, League Snapshot, Key Insights
      LeagueAnalyzer.tsx   - Power Rankings, Tier Breakdown, Roster Comparison
      TeamBreakdown.tsx    - Roster Strength, Age Curve, Depth Chart
      TradeCenter.tsx      - Trade Finder, Trade Targets, Trade Block Scanner
      DraftCapital.tsx     - Pick Value, Pick Distribution
      LeagueMarket.tsx     - Positional Surplus, Market Value
      Insights.tsx         - Team Insights, League Trends
```

## Branding
- Brand Navy: #0b3a7a
- Brand Gold: #d4af37
- Font: Inter
- Dark mode supported via class toggle

## Tech Stack
- React 18 + TypeScript
- Vite dev server
- TailwindCSS with shadcn/ui components
- Wouter for routing
- No database - mock data only for MVP
