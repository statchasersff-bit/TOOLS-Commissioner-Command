# Dynasty Command Center - StatChasers

## Overview
Dynasty Command Center is a premium fantasy football league analysis tool designed to provide in-depth insights for dynasty leagues. It integrates with the Sleeper API for real league data and FantasyCalc for player valuations, offering advanced analytics like power rankings, trade evaluations, and player market analysis. The project aims to empower fantasy football enthusiasts with data-driven decision-making capabilities, improving roster management and trade strategies.

## User Preferences
- **Communication Style**: Clear and concise language.
- **Coding Style**: Focus on maintainable and readable code.
- **Workflow**: Iterative development with clear milestones.
- **Interaction**: Ask for confirmation before implementing major changes or complex features.
- **General Working Preferences**: Prioritize functionality and performance. Ensure all integrations are robust and error-handled gracefully.

## System Architecture
The application uses a React + TypeScript frontend with a Vite development server and an Express.js backend. The UI features a two-level tab navigation system (main tabs with sub-tabs) and leverages `localStorage` for state persistence (tab, sub-tab, active league, Sleeper connection).

**UI/UX Decisions:**
- **Branding**: Utilizes "Brand Navy" (#0b3a7a) and "Brand Gold" (#d4af37) with the Inter font.
- **Theming**: Supports dark mode.
- **Navigation**: Rounded-full pill-shaped tabs with a gold underline for active indicators.
- **Layout**: Cards feature `p-6` padding and a hover-elevate effect. Section headers are bold (`text-xl`/`text-2xl`) with a 3px gold accent bar.
- **Loading States**: Skeleton loading (skeleton-pulse animation) is used for KPIs and data tables.
- **Background**: Subtle blueprint grid texture that adapts to dark mode.
- **Components**: Utilizes `KpiCard`, `DataTable` (with sticky first column and alternating row colors), `InsightCallout`, `SectionHeader`, and `ThemeToggle`.
- **Avoidances**: The `Popover` component is explicitly avoided due to React hook errors; `Tooltip` is used instead.

**Technical Implementations:**
- **State Management**: `SleeperProvider` manages account connection, league list, and active league. `ValueModelProvider` handles all value calculations (player values, pick values, team metrics).
- **Navigation**: State-based navigation with URL query parameter persistence (`?tab=X&sub=Y`).
- **Data Persistence**: `localStorage` is used for `sc-dynasty-state` (tab/sub/league) and `sc-sleeper-connection`.
- **Lineup Optimization**: `optimizeLineup()` in `ValueModelContext` automatically fills roster slots with the highest redraft-value eligible players for accurate team potential analysis, rather than using Sleeper's saved starters.
- **Value Model**: Supports parallel fetching of dynasty and redraft values from FantasyCalc.
- **League-relative Scoring**: Team metrics are scaled to a 10-99 range relative to other teams in the league.
- **Power Score Formula**: `0.45 * Starter Value + 0.25 * Bench Value + 0.20 * Picks + 0.10 * Youth`.

**Feature Specifications:**
- **Tab Structure**:
    - **Portfolio**: Connect, My Leagues, Portfolio Summary (cross-league analysis, player exposure, lineup alerts).
    - **My Team (dashboard)**: Overview, Roster Strength, Age Curve, Depth Chart.
    - **League Analyzer**: Power Rankings, Roster Comparison, League Intelligence, League Economy.
    - **Trade Center**: Trade Database, Trade Calculator, Positional Analysis, Trade Targets, Trade Block Scanner.
    - **Players (league-market)**: Market Value.
    - **Live Draft**: Dynasty Rankings Board (ranks top 300 players, integrates with Sleeper drafts).
- **Sleeper Data Transformation**: Transforms Sleeper roster data into a custom League/Team/Player format, detecting format (SF/1QB) and filtering roster positions to starter slots.
- **Trade Calculator**: Premium tool with two-column trade builder, trade partner selector, auto-roster loading, diminishing returns value adjustment, and fairness badges (Fair, Slight Overpay, Overpay). It also provides position impact analysis and suggested counter offers.

## External Dependencies
- **Sleeper API**: Integrated via a backend proxy (`server/sleeper.ts`) for user lookup, league data, portfolio summaries, cross-league trade scanning, and draft data.
- **FantasyCalc API**: Integrated for dynasty and redraft player trade values (`/api/values/fantasycalc`). Values are cached daily (`/tmp/fantasycalc_cache_*.json`) and daily snapshots are stored in a `player_value_snapshots` table.
- **PostgreSQL Database**: Used for the Trade Database, storing crawled league and trade data. The schema is defined in `shared/schema.ts`.
- **Wouter**: For client-side routing.
- **TailwindCSS with shadcn/ui**: For styling and UI components.