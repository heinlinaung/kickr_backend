/**
 * Migrate `Event.status` from the capacity model to the 6-state lifecycle.
 *
 * WHY
 * ---
 * The old enum was `open | full | done`, where `full` doubled as a capacity
 * flag. The lifecycle (spec §4.1) replaces it with
 * `join -> before_match -> preparation -> playing -> after_match -> done`
 * and derives capacity instead: `isFull = joinedCount >= maxPlayers`.
 *
 * MAPPING (spec §4.2)
 * -------------------
 *   open -> join
 *   full -> join    a full event is still logically in registration; capacity
 *                   is now derived, so nothing is lost by collapsing this
 *   done -> done    unchanged
 *
 * Also backfills the step-1 columns that later build steps fill, so this is
 * the only pass over the events collection:
 *   startTime, endTime  -> null
 *   teamCount           -> 4
 *   coverImage(FileId)  -> null
 *   photos, matches     -> []
 *   result, templateId  -> null
 *   likeCount           -> 0
 *
 * USAGE
 * -----
 *   # dry run (default — reports what WOULD change, writes nothing)
 *   npx ts-node scripts/migrate-event-status.ts
 *
 *   # apply
 *   npx ts-node scripts/migrate-event-status.ts --apply
 *
 * Reads MONGODB_URI from .env. Safe to re-run: rows already carrying a
 * lifecycle status are left alone, and the backfill only sets absent fields.
 *
 * COORDINATE BEFORE RUNNING: clients pinned to the old enum will not
 * recognise `join` (spec §9, first risk).
 */
import { config as loadEnv } from 'dotenv';
import mongoose from 'mongoose';

loadEnv();

const APPLY = process.argv.includes('--apply');

/** Old value -> new value. Anything not listed is left untouched. */
const STATUS_MAP: Readonly<Record<string, string>> = {
  open: 'join',
  full: 'join',
  done: 'done',
};

const LIFECYCLE = [
  'join',
  'before_match',
  'preparation',
  'playing',
  'after_match',
  'done',
];

/** Columns landed by step 1, empty until steps 2-3 fill them. */
const BACKFILL: Readonly<Record<string, unknown>> = {
  startTime: null,
  endTime: null,
  teamCount: 4,
  coverImage: null,
  coverImageFileId: null,
  photos: [],
  result: null,
  matches: [],
  templateId: null,
  likeCount: 0,
};

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set (check your .env)');
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database handle after connecting');

  const events = db.collection('events');

  console.log(
    APPLY
      ? '=== APPLYING changes ==='
      : '=== DRY RUN (no writes) — pass --apply to commit ===',
  );

  const total = await events.countDocuments({});
  console.log(`Events in collection: ${total}`);

  // --- 1. status remap -------------------------------------------------
  let remapped = 0;
  const unknown = new Map<string, number>();

  for (const [from, to] of Object.entries(STATUS_MAP)) {
    if (from === to) continue; // done -> done is a no-op
    const count = await events.countDocuments({ status: from });
    if (!count) continue;
    console.log(`  ${from} -> ${to} : ${count}`);
    if (APPLY) {
      await events.updateMany({ status: from }, { $set: { status: to } });
    }
    remapped += count;
  }

  // Anything neither in the map nor already a lifecycle value needs eyes on
  // it — surface rather than silently coerce.
  const strays = await events
    .find(
      { status: { $nin: [...Object.keys(STATUS_MAP), ...LIFECYCLE] } },
      { projection: { _id: 1, status: 1 } },
    )
    .toArray();
  for (const row of strays) {
    const key = String(row.status);
    unknown.set(key, (unknown.get(key) ?? 0) + 1);
  }

  const alreadyMigrated = await events.countDocuments({
    status: { $in: LIFECYCLE.filter((s) => s !== 'done') },
  });

  // --- 2. backfill the step-1 columns ----------------------------------
  // One updateMany per field, each scoped to rows missing it, so re-runs are
  // cheap and a partially-migrated collection converges.
  let backfilled = 0;
  for (const [field, value] of Object.entries(BACKFILL)) {
    const missing = await events.countDocuments({
      [field]: { $exists: false },
    });
    if (!missing) continue;
    console.log(`  backfill ${field} : ${missing}`);
    if (APPLY) {
      await events.updateMany({ [field]: { $exists: false } }, {
        $set: { [field]: value },
      } as Record<string, unknown>);
    }
    backfilled += missing;
  }

  if (unknown.size) {
    console.log('\nSKIPPED — unrecognised status values, resolve by hand:');
    for (const [value, count] of unknown) {
      console.log(`  ? "${value}" on ${count} event(s)`);
    }
  }

  console.log('\n--- summary ---');
  console.log(`  ${APPLY ? 'remapped' : 'would remap'} : ${remapped}`);
  console.log(`  already on a lifecycle status : ${alreadyMigrated}`);
  console.log(
    `  ${APPLY ? 'backfilled' : 'would backfill'} field writes : ${backfilled}`,
  );
  console.log(`  unrecognised : ${unknown.size}`);
  if (!APPLY && (remapped > 0 || backfilled > 0)) {
    console.log('\nRe-run with --apply to commit these changes.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
