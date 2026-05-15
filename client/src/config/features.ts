export const FEATURES = {
  USE_SHARED_TRADE_MODAL: true,
  ENABLE_DMS: true,
  ENABLE_COUNTER_TRADES: true,
  ENABLE_LIVE_DRAFT: false,
} as const;

export type FeatureFlag = keyof typeof FEATURES;
