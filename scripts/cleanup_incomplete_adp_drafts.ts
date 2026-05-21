/**
 * One-time cleanup: reset draft rows the ADP crawl left in a half-saved
 * state. Run this AFTER deploying the transactional-ingest fix to clear
 * the backlog of "drafts marked complete in DB but with no picks".
 *
 * Usage:
 *   tsx scripts/cleanup_incomplete_adp_drafts.ts            # apply
 *   tsx scripts/cleanup_incomplete_adp_drafts.ts --dry-run  # report only
 *
 * Reports counts and exits non-zero if the recovery sweep encountered an
 * error. Safe to run repeatedly; idempotent.
 */

import { recoverAdpCrawlState, repairIncompleteDrafts } from "../server/adpCrawlRepair";

// DATABASE_URL is expected to be present in the environment already (the
// Replit/Render runtime injects it). The server modules read it directly.
if (!process.env.DATABASE_URL) {
  console.error("[cleanup] DATABASE_URL not set; aborting.");
  process.exit(1);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`[cleanup] starting — dryRun=${dryRun}`);

  const recovery = await recoverAdpCrawlState();
  console.log(
    `[cleanup] crash recovery: ` +
    `staleScansFlagged=${recovery.staleScansFlagged} ` +
    `staleQueueItemsReset=${recovery.staleQueueItemsReset}`,
  );

  const drafts = await repairIncompleteDrafts({ dryRun });
  console.log(
    `[cleanup] draft repair: ` +
    `inspected=${drafts.inspected} ` +
    `orphansDeleted=${drafts.orphansDeleted} ` +
    `partialsDeleted=${drafts.partialsDeleted}`,
  );

  console.log(`[cleanup] done.`);
  // The shared pg.Pool in adpCrawlRepair keeps the process alive; force
  // exit so the CLI returns to the shell.
  process.exit(0);
}

main().catch((err) => {
  console.error("[cleanup] failed:", err);
  process.exit(1);
});
