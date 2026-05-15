// Sleeper GraphQL operation registry.
// Mirrors the SleeperOperations constant in sleeperApi.ts for
// operations defined in this sub-module (sleeper/graphql/).

export const SleeperRosterOperations = {
  updateReserve: {
    key: "updateReserve",
    operationName: "roster_update_reserve",
    category: "roster_management",
    authRequired: true,
    writeAction: true,
    priority: "high" as const,
  },
  updateTaxi: {
    key: "updateTaxi",
    operationName: "roster_update_taxi",
    category: "roster_management",
    authRequired: true,
    writeAction: true,
    priority: "high" as const,
  },
} as const;
