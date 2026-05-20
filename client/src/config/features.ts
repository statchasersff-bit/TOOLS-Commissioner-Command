export const FEATURES = {
  USE_SHARED_TRADE_MODAL: true,
  ENABLE_DMS: true,
  ENABLE_COUNTER_TRADES: true,
  ENABLE_LIVE_DRAFT: false,
  // Temporary kill-switch: when false, the entire Draft tab (Draft Board +
  // ADP Explorer) is hidden from navigation and any direct URL/saved-state
  // routing falls back to Portfolio. Flip to `true` to bring it back.
  SHOW_DRAFT_MODULE: true,
} as const;

export type FeatureFlag = keyof typeof FEATURES;
