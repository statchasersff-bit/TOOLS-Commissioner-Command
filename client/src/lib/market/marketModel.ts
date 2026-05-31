// Re-export of the shared market model. The implementation lives in
// @shared/market so the client page and the server API share one copy.
// buildMarketPlayers accepts any MarketInput[]; the client passes its
// RankedPlayer[] (structurally assignable) from ValueModelContext.
export * from "@shared/market/marketModel";
