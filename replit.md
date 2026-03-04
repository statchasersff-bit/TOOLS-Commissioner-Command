# Dynasty Command Center - StatChasers

## Overview
A premium dynasty fantasy football league analysis tool built with React + TypeScript + Vite. Uses a two-level tab navigation system (main tabs -> sub tabs) with mock data ready to be wired to Sleeper API.

## Architecture
- **Frontend-only MVP** with mock data (no database needed yet)
- State-based navigation with URL query param persistence (?tab=X&sub=Y)
- localStorage persistence for tab, sub-tab, and league selection (key: "sc-dynasty-state")
- Two-level tab system: 7 main tabs, each with 2-3 sub-tabs
- Empty state landing until league is selected; first selection lands on Dashboard > Overview

## Project Structure
```
client/src/
  types/index.ts          - TypeScript interfaces (League, Team, Player, Pick, etc.)
  data/mockData.ts        - Mock league data generator + nav config + utility functions
  components/
    MainTabs.tsx           - Top-level tab navigation (rounded-full pills, gold underline)
    SubTabs.tsx            - Second-level tab navigation (rounded-full pills, gold underline)
    LeagueSelector.tsx     - League dropdown selector
    KpiCard.tsx            - Metric display cards with skeleton loading state
    DataTable.tsx          - Sortable/scrollable data table with skeleton loading, sticky columns
    InsightCallout.tsx     - Positive/neutral/negative insight cards
    SectionHeader.tsx      - Section headers with gold accent bar (text-xl/2xl bold)
    ThemeToggle.tsx        - Dark/light mode toggle
  pages/
    DynastyCommandCenter.tsx - Main page orchestrator (blueprint-bg texture)
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

## UX Features
- "Jump to" mini menu on Dashboard Overview links to Snapshot and Key Insights sub-tabs
- KPI cards support "?" tooltip icons explaining what each metric means
- State restored from localStorage on refresh (tab, sub-tab, league)
- URL query params (?tab=X&sub=Y) take priority over localStorage when present

## UI Polish
- Tabs: rounded-full pill shape with gold underline active indicator
- Cards: p-6 padding for breathing room, hover-elevate effect
- Section headers: text-xl/text-2xl font-bold with 3px gold accent bar
- Blueprint background: subtle grid texture on main page (adapts to dark mode)
- Skeleton loading: skeleton-pulse animation for KpiCard and DataTable
- DataTable: sticky first column with proper background inheritance, alternating row colors
- Typography: bolder headings (text-base font-bold) inside cards, uppercase tracking-wider labels

## Tech Stack
- React 18 + TypeScript
- Vite dev server
- TailwindCSS with shadcn/ui components
- Wouter for routing
- No database - mock data only for MVP
