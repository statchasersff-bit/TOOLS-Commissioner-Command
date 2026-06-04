/**
 * Lineup Integrity & Anti-Tanking service (Commissioner Command, Phase 1).
 * See ./ingestLineupIntegrity.ts for the scan pipeline overview.
 */
export * from "./types";
export { ingestLineupIntegrityForLeague } from "./ingestLineupIntegrity";
export type { IngestOptions, IngestResult } from "./ingestLineupIntegrity";
export {
  getLineupIntegritySettings,
  upsertLineupIntegritySettings,
} from "./lineupIntegritySettings";
export {
  getOverview,
  listChecks,
  getCheckDetail,
  listAlerts,
  updateAlert,
  getManagerHistory,
  getWeeklyReport,
  getMultiLeagueSummary,
  getLatestWeek,
} from "./lineupIntegrityQueries";
export { issueStrike, updateStrike, listStrikes } from "./strikeService";
export { buildCopyMessages, RECOMMENDED_POLICY_TEXT } from "./lineupIntegritySummary";
export { DEFAULT_LINEUP_INTEGRITY_SETTINGS } from "./types";
