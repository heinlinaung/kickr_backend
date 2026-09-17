/**
 * Seed the `sporttypes` collection — the allowed values for `sportType` on
 * groups and events.
 *
 * WHY
 * ---
 * `sportType` used to be constrained by three hardcoded enums that had already
 * drifted apart (group schema: football/futsal/padel/basketball, event schema:
 * football/badminton, event DTOs: football/futsal). This collection is now the
 * single source of truth: group/event create/update validate against it, and
 * adding a sport is a seed-list edit plus a re-run instead of a deploy.
 *
 * The seed list is the UNION of the old enums, so no existing document holds a
 * value the collection does not know.
 *
 * `subTypes` are the formats an EVENT of that sport may set as `subType` —
 * only football has any (futsal, stadium). Groups and events store the plain
 * `value` string, never an ObjectId ref, so seeding order and _ids carry no
 * meaning beyond `sortOrder` display order.
 *
 * IDEMPOTENT
 * ----------
 * Matches on `value` and upserts, so re-running:
 *   - inserts anything missing,
 *   - refreshes `subTypes`/`sortOrder` on rows that exist,
 *   - never duplicates a sport (`value` is uniquely indexed).
 *
 * Sports in the collection but NOT in this list are reported and left alone —
 * deleting one could strand groups/events already carrying its value. Remove
 * those by hand if a sport is genuinely gone.
 *
 * USAGE
 * -----
 *   # dry run (default — reports what WOULD change, writes nothing)
 *   npx ts-node scripts/seed-sport-types.ts
 *
 *   # apply
 *   npx ts-node scripts/seed-sport-types.ts --apply
 *
 * Reads MONGODB_URI from .env. Safe to re-run.
 */
import { config as loadEnv } from 'dotenv';
import mongoose from 'mongoose';

loadEnv();

const APPLY = process.argv.includes('--apply');

const SPORT_TYPES: { value: string; subTypes: string[]; sortOrder: number }[] =
  [
    { value: 'football', subTypes: ['futsal', 'stadium'], sortOrder: 1 },
    { value: 'futsal', subTypes: [], sortOrder: 2 },
    { value: 'badminton', subTypes: [], sortOrder: 3 },
    { value: 'padel', subTypes: [], sortOrder: 4 },
    { value: 'basketball', subTypes: [], sortOrder: 5 },
  ];

function sameStringArray(a: unknown, b: string[]): boolean {
  return (
    Array.isArray(a) && a.length === b.length && b.every((v, i) => a[i] === v)
  );
}

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
  const col = db.collection('sporttypes');

  const existing = await col.find({}).toArray();
  const byValue = new Map(existing.map((row) => [String(row.value), row]));

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const sport of SPORT_TYPES) {
    const current = byValue.get(sport.value);

    if (!current) {
      console.log(
        `+ insert  ${sport.value} (subTypes [${sport.subTypes.join(', ')}], ` +
          `sortOrder ${sport.sortOrder})`,
      );
      if (APPLY) {
        const now = new Date();
        await col.insertOne({ ...sport, createdAt: now, updatedAt: now });
      }
      inserted += 1;
      continue;
    }

    if (
      current.sortOrder !== sport.sortOrder ||
      !sameStringArray(current.subTypes, sport.subTypes)
    ) {
      console.log(
        `~ update  ${sport.value}: subTypes [${String(current.subTypes)}] -> ` +
          `[${sport.subTypes.join(', ')}], sortOrder ` +
          `${String(current.sortOrder)} -> ${sport.sortOrder}`,
      );
      if (APPLY) {
        await col.updateOne(
          { _id: current._id },
          {
            $set: {
              subTypes: sport.subTypes,
              sortOrder: sport.sortOrder,
              updatedAt: new Date(),
            },
          },
        );
      }
      updated += 1;
      continue;
    }

    unchanged += 1;
  }

  // Reported, never deleted: a row's value could already be stored on groups
  // or events, and removing it would make those documents fail validation on
  // their next sportType write.
  const seeded = new Set(SPORT_TYPES.map((s) => s.value));
  const extra = existing.filter((row) => !seeded.has(String(row.value)));
  for (const row of extra) {
    console.log(
      `! in DB but not in the seed list: ${String(row.value)} (left alone)`,
    );
  }

  console.log('\n--- Summary ---');
  console.log(`Inserted   : ${inserted}`);
  console.log(`Updated    : ${updated}`);
  console.log(`Unchanged  : ${unchanged}`);
  console.log(`Not seeded : ${extra.length} (left in place)`);
  if (!inserted && !updated) console.log('Nothing to do — already seeded.');
  if (!APPLY) console.log('\nDry run only. Re-run with --apply to commit.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
