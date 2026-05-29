# Dynasty Command Responsive System

A reusable set of primitives so every page adapts to screen size, device type, and
the actual width of its container — not just "shrinks." Build new pages on these and
they inherit the same behavior for free; migrate existing pages incrementally using
the rollout map below.

## Breakpoints (one source of truth)

`client/src/hooks/useResponsive.ts` → `BREAKPOINTS`, mirrored by Tailwind screens in
`tailwind.config.ts`:

| name      | px    | Tailwind | device            |
|-----------|-------|----------|-------------------|
| mobileSm  | 360   | `2xs`    | very small mobile |
| mobile    | 480   | `xs`     | large mobile      |
| tablet    | 768   | `md`     | tablet            |
| laptop    | 1024  | `lg`     | small laptop      |
| desktop   | 1280  | `xl`     | desktop           |
| wide      | 1536  | `2xl`    | wide desktop      |

JS decisions and CSS classes stay in lockstep: `useResponsive().isTablet` and `md:`
break at the same 768px.

## The primitives

### 1. `useResponsive()` — viewport awareness
```ts
const { width, isMobile, isTablet, isLaptop, isDesktop, isWide, bucket, up, down } = useResponsive();
if (down("tablet")) … // width < 768
```
Single shared, rAF-throttled resize listener for all consumers.

### 2. `useContainerWidth()` — container awareness (preferred for tables/cards)
```ts
const { ref, width } = useContainerWidth<HTMLDivElement>();
return <div ref={ref}>{width < 480 ? <Cards/> : <Table/>}</div>;
```
Use this whenever a component can be narrow even on a wide screen (e.g. a table in a
340px sidebar). `width === 0` means "not measured yet" — treat as desktop.

### 3. `<ResponsiveTable>` — `client/src/components/ResponsiveTable.tsx`
One column config, three mobile behaviors. Picks layout from **container** width.
```tsx
<ResponsiveTable
  columns={columns}      // ResponsiveTableColumn<T>[]
  data={players}
  rowKey={(r) => r.id}
  mobileMode="priority"  // "scroll" | "priority" | "cards"
  expandableRows
/>
```
Column config:
```ts
{
  key: "tradeValue", label: "Trade Value",
  shortLabel: "Value", mobileLabel: "Val",   // optional; falls back to the abbrev dict
  priority: 1,           // lower = more important (priority mode + sticky pick)
  minWidth: 72,          // px hint
  hideBelow: 768,        // hide column under this width
  abbreviateBelow: 1024, // use short label under this width (default 1024)
  align: "right",
  sticky: true,          // pin in scroll mode (defaults to first column)
  render: (r) => r.tradeValue.toLocaleString(),
  detailLabel: "Trade Value", // label inside the expand row (priority mode)
}
```
Modes:
- **scroll** (default & desktop): horizontal scroll, sticky first column + edge fades.
  Dense analytics tables.
- **priority**: keep `priority ≤ 2` (<480) / `≤ 3` (<768); the rest fold into a
  tap-to-expand detail row. Compact rankings / leaderboards.
- **cards**: each row becomes a stacked card. Rich per-row objects (trades, leagues).

Headers abbreviate automatically and always keep the full label in `title=`.

### 4. `<ResponsiveFilterBar>` — `client/src/components/ResponsiveFilterBar.tsx`
Inline on desktop/tablet, collapses secondary filters into a bottom-sheet drawer on
mobile while search stays visible. Shows an active-filter count badge + Reset/Apply.
```tsx
<ResponsiveFilterBar search={<SearchInput/>} activeCount={n} onReset={reset}>
  <PositionSelect/> <TeamSelect/> <SortSelect/>
</ResponsiveFilterBar>
```

### 5. Player name / image helpers (already app-wide)
- `formatPlayerName(name, "full"|"initial"|"last")`, `nameModeForWidth(width)`, and
  `<ResponsivePlayerName>` (auto-shortens "CeeDee Lamb"→"C. Lamb" only when it would
  overflow; full name in `title`).
- `<PlayerAvatar>` — fixed, non-shrinking circle + team badge, `object-cover`,
  initials fallback on image error, `shortName` prop for cramped tables.

### 6. Abbreviation dictionary — `client/src/lib/columnAbbreviations.ts`
`abbreviateLabel(label, width)`, `shortLabel()`, `mobileLabel()`. Add new stat labels
here so abbreviations stay consistent everywhere.

### 7. CSS utilities — `client/src/index.css` (theme-aware, `--sc-*` tokens)
| class | purpose |
|-------|---------|
| `.dc-scroll-x` | horizontal scroll box with edge fades (set `data-at-start/-end` to gate them) |
| `.dc-sticky-col` | pin a table column (apply to matching `th` + `td`) |
| `.dc-sticky-head` | sticky `thead` (pair with a max-height) |
| `.dc-card-grid` | `auto-fit minmax(260px,1fr)` → 1 col < 480 |
| `.dc-stat-grid` | KPI grid → 2 cols < 480 → 1 col < 360 |
| `.dc-detail-layout` | main + 340px sidebar → stacked ≤ 1024 |
| `.dc-sticky-actions` | bottom action bar on mobile, inline ≥ 768 |
| `.dc-touch` | min 44px tap target < 768 |
| `.dc-page-title` / `.dc-section-title` / `.dc-card-value` | fluid `clamp()` type |
| `.dc-min-w-0` / `.dc-clip` | flex-child overflow safety / truncation |

## Table decision tree
- 4–6 key columns, compact → **priority** (+ expandable rows)
- many stat columns → **scroll** (sticky player column)
- each row is a rich object/person/team → **cards**
- comparison table → stacked comparison cards on mobile
- trade / transaction table → **cards** or **priority**

## Reference implementation
`client/src/pages/tabs/LeagueMarket.tsx` — `ResponsiveFilterBar` (position filter →
drawer on mobile) + `.dc-scroll-x` edge fades + `.dc-sticky-col` pinned player column,
with edge `data-at-*` driven from the existing overflow `ResizeObserver`.

## Per-page rollout map
Recommended primary pattern per surface (apply incrementally):

| Page / tab | Tables / key surfaces | Recommended pattern |
|---|---|---|
| Dashboard / Command Center | KPI tiles, position columns, heatmap | `.dc-stat-grid`; position rows already scroll — wrap in `.dc-scroll-x` |
| Team page / TeamBreakdown | roster, tier breakdown | roster → **priority**; tiers → `.dc-card-grid` |
| LeagueMarket ✅ done | market values | **scroll** + sticky player col + filter drawer |
| LeagueAnalyzer / power rankings | rankings | **priority** (Rank·Player·Pos·Value, expand rest) |
| PositionStats / PositionalAnalysis | advanced stats | **scroll** + sticky player col (already hand-rolled; migrate to `<ResponsiveTable>`) |
| WaiverCommand | waiver targets, claims | **scroll** sticky col; filters → `ResponsiveFilterBar` |
| TradeCenter / BulkTrades | proposals, finder | proposal cards; finder filters → drawer; `.dc-sticky-actions` for Analyze |
| TradeSync / Transactions | trade/transaction history | **cards** (Date / Side A / Side B / Δ / Winner) |
| ManagerPage | leagues tab, comparisons | leagues → **cards**; comparison → stacked cards; tabs → scrollable |
| PlayerPage | profile hero + stat tables | `.dc-detail-layout`; weekly/advanced tables → **scroll** sticky col |
| MatchupDetail | matchup two-column | `.dc-detail-layout`; lineup → **priority** |
| Portfolio | value history table/graph | **scroll**; chart container `min-w-0` |
| DraftCommand / LiveDraft | draft board, available players | board keeps `min-w` scroll in `.dc-scroll-x`; available → **priority** |
| FinanceTab / LeagueEconomy | cap/finance tables | **scroll** sticky col |
| SettingsPage / ManageAccount | forms | single column ≤ tablet; `.dc-touch` on controls |

## QA checklist
Test each major page at: **320, 360, 375, 390, 414, 480, 768, 1024, 1280, 1440, 1536, 1920**.

For every page verify:
- [ ] No accidental horizontal **page** overflow (only intentional `.dc-scroll-x` boxes scroll)
- [ ] Player images never distort / crush (fixed `min-w`, `object-cover`)
- [ ] Table headers readable (abbreviate, don't wrap-break); full label in `title`
- [ ] No important column vanishes without being reachable (expand row / scroll)
- [ ] Filters never run off-screen; search stays visible; dropdowns open on-screen
- [ ] No giant desktop whitespace; no sub-intended card widths
- [ ] Tabs fit (scroll or dropdown), never silently hidden
- [ ] Player names shorten before truncating
- [ ] Tap targets ≥ 44px on mobile; spacing between controls
- [ ] No layout shift when crossing a breakpoint (stable image boxes, skeletons)

Quick check in dev tools: set width to each value, scroll the page — only elements
inside a `.dc-scroll-x` should scroll horizontally; `document.documentElement` should
not.
