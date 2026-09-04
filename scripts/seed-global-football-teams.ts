/**
 * Seed the `globalfootballteams` collection with Premier League clubs.
 *
 * WHY
 * ---
 * Reference data a user picks their supported club from. It is not user
 * content, so it is seeded rather than created through the API — there is no
 * write endpoint for it.
 *
 * The source list carried a numeric `id` (1..20). That is deliberately NOT
 * stored: Mongo's `_id` is the identity, and keeping a second one invites
 * documents being referenced by the wrong key. `sort_order` IS kept, as
 * `sortOrder`, because it is real display data — the intended order is by
 * league standing, not alphabetical.
 *
 * IDEMPOTENT
 * ----------
 * Matches on `name` and upserts, so re-running:
 *   - inserts anything missing,
 *   - refreshes `sortOrder` on rows that exist,
 *   - never duplicates a club (`name` is uniquely indexed),
 *   - never touches the `_id` of an existing row, so anything already
 *     referencing one keeps working.
 *
 * Clubs in the collection but NOT in this list are reported and left alone —
 * deleting them could break a user profile pointing at one. Remove those by
 * hand if a club is genuinely gone.
 *
 * USAGE
 * -----
 *   # dry run (default — reports what WOULD change, writes nothing)
 *   npx ts-node scripts/seed-global-football-teams.ts
 *
 *   # apply
 *   npx ts-node scripts/seed-global-football-teams.ts --apply
 *
 * Reads MONGODB_URI from .env. Safe to re-run.
 */
import { config as loadEnv } from 'dotenv';
import mongoose from 'mongoose';

loadEnv();

const APPLY = process.argv.includes('--apply');

/** Name + display order. The source `id` is intentionally dropped. */
const TEAMS: { name: string; sortOrder: number }[] = [
  { name: 'Manchester United', sortOrder: 1 },
  { name: 'Liverpool', sortOrder: 2 },
  { name: 'Arsenal', sortOrder: 3 },
  { name: 'Chelsea', sortOrder: 4 },
  { name: 'Manchester City', sortOrder: 5 },
  { name: 'Tottenham Hotspur', sortOrder: 6 },
  { name: 'Newcastle United', sortOrder: 7 },
  { name: 'West Ham United', sortOrder: 8 },
  { name: 'Aston Villa', sortOrder: 9 },
  { name: 'Everton', sortOrder: 10 },
  { name: 'Crystal Palace', sortOrder: 11 },
  { name: 'Brighton & Hove Albion', sortOrder: 12 },
  { name: 'Fulham', sortOrder: 13 },
  { name: 'Nottingham Forest', sortOrder: 14 },
  { name: 'AFC Bournemouth', sortOrder: 15 },
  { name: 'Brentford', sortOrder: 16 },
  { name: 'Leeds United', sortOrder: 17 },
  { name: 'Sunderland', sortOrder: 18 },
  { name: 'Burnley', sortOrder: 19 },
  { name: 'Wolverhampton Wanderers', sortOrder: 20 },
];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set — is .env present?');
    process.exit(1);
  }

  // Guard against seeding the wrong database by accident: print where this is
  // going before doing anything, with credentials stripped.
  console.log(`Target: ${uri.replace(/\/\/[^@]*@/, '//<redacted>@')}`);
  console.log(
    APPLY
      ? '=== APPLYING changes ==='
      : '=== DRY RUN (no writes) — pass --apply to commit ===',
  );

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database handle after connect');
  const col = db.collection('globalfootballteams');

  const existing = await col.find({}).toArray();
  const byName = new Map(existing.map((row) => [String(row.name), row]));

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const team of TEAMS) {
    const current = byName.get(team.name);

    if (!current) {
      console.log(`+ insert  ${team.name} (sortOrder ${team.sortOrder})`);
      if (APPLY) {
        const now = new Date();
        await col.insertOne({ ...team, createdAt: now, updatedAt: now });
      }
      inserted += 1;
      continue;
    }

    if (current.sortOrder !== team.sortOrder) {
      console.log(
        `~ update  ${team.name}: sortOrder ${String(current.sortOrder)} -> ${team.sortOrder}`,
      );
      if (APPLY) {
        await col.updateOne(
          { _id: current._id },
          { $set: { sortOrder: team.sortOrder, updatedAt: new Date() } },
        );
      }
      updated += 1;
      continue;
    }

    unchanged += 1;
  }

  // Reported, never deleted: a row could already be referenced by a user's
  // profile, and removing it would leave a dangling id.
  const seeded = new Set(TEAMS.map((t) => t.name));
  const extra = existing.filter((row) => !seeded.has(String(row.name)));
  for (const row of extra) {
    console.log(
      `! in DB but not in the seed list: ${String(row.name)} (left alone)`,
    );
  }

  console.log('\n--- Summary ---');
  console.log(`Inserted   : ${inserted}`);
  console.log(`Updated    : ${updated}`);
  console.log(`Unchanged  : ${unchanged}`);
  console.log(`Not seeded : ${extra.length} (left in place)`);
  console.log(`Total after: ${APPLY ? existing.length + inserted : '(dry run)'}`);
  if (!inserted && !updated) console.log('Nothing to do — already seeded.');
  if (!APPLY) console.log('\nDry run only. Re-run with --apply to commit.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
