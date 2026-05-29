// One-off fix: adds the missing `preferences` jsonb column to sc_users, which
// the in-progress preferences feature declared in the Drizzle schema but never
// pushed to the DB — breaking every sc_users query (including login).
// Safe + idempotent: ADD COLUMN IF NOT EXISTS, nullable. Re-running is a no-op.
// Run with:  node fix-login-column.cjs
const { Client } = require("pg");

const client = new Client({ connectionString: process.env.DATABASE_URL });
client
  .connect()
  .then(() => client.query("ALTER TABLE sc_users ADD COLUMN IF NOT EXISTS preferences jsonb"))
  .then(() =>
    client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'sc_users' AND column_name = 'preferences'",
    ),
  )
  .then((r) => {
    console.log(r.rows.length === 1 ? "✅ DONE — preferences column is present." : "⚠️ Column still missing — check errors above.");
  })
  .catch((e) => console.log("ERR:", e.message))
  .finally(() => client.end());
