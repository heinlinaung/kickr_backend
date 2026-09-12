/**
 * Diagnose — and optionally repair — the `eventplayers` unique index that
 * stops a second guest being added to an event.
 *
 * THE SYMPTOM
 * -----------
 * `POST /events/:id/guests` succeeds for the first guest and fails for the
 * second, so the event appears to allow only one. The application cap is
 * MAX_GUESTS_PER_MEMBER = 2 and is NOT the cause — unit tests confirm the
 * second add is permitted and only the third is refused.
 *
 * THE CAUSE
 * ---------
 * The schema declares:
 *
 *   { eventId: 1, userId: 1 }
 *   { unique: true, partialFilterExpression: { userId: { $exists: true } } }
 *
 * Guests carry NO `userId`. The partial filter is what keeps them out of the
 * uniqueness rule. But **Mongoose only creates an index it does not already
 * find** — it will not alter one whose keys match. So a database still holding
 * the older PLAIN unique index from before guests existed keeps it, every guest
 * row collides on `(eventId, null)`, and only the first can insert.
 *
 * WHAT THIS SCRIPT DOES
 * ---------------------
 * Reports every index on `eventplayers`, names the offending one if present,
 * and with `--apply` drops it and builds the correct one.
 *
 * USAGE
 * -----
 *   # report only (default — writes nothing)
 *   npx ts-node scripts/fix-event-player-index.ts
 *
 *   # repair
 *   npx ts-node scripts/fix-event-player-index.ts --apply
 *
 * Reads MONGODB_URI from .env. Safe to re-run: if the index is already correct
 * it reports so and changes nothing.
 */
import { config as loadEnv } from 'dotenv';
import mongoose from 'mongoose';

loadEnv();

const APPLY = process.argv.includes('--apply');

const KEY = { eventId: 1, userId: 1 };
const WANTED_PARTIAL = { userId: { $exists: true } };

/** True when two index key specs are the same fields in the same order. */
function sameKey(a: Record<string, unknown>, b: Record<string, unknown>) {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  return (
    ak.length === bk.length && ak.every((k, i) => bk[i] === k && a[k] === b[k])
  );
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set — is .env present?');
    process.exit(1);
  }

  console.log(`Target: ${uri.replace(/\/\/[^@]*@/, '//<redacted>@')}`);
  console.log(
    APPLY
      ? '=== APPLYING changes ==='
      : '=== REPORT ONLY — pass --apply to repair ===',
  );

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database handle after connect');
  const col = db.collection('eventplayers');

  const indexes = await col.indexes();
  console.log('\n--- Indexes on eventplayers ---');
  for (const index of indexes) {
    const partial = index.partialFilterExpression
      ? ` partial=${JSON.stringify(index.partialFilterExpression)}`
      : '';
    const unique = index.unique ? ' UNIQUE' : '';
    console.log(`  ${index.name}: ${JSON.stringify(index.key)}${unique}${partial}`);
  }

  const target = indexes.find(
    (index) => sameKey(index.key as Record<string, unknown>, KEY) && index.unique,
  );

  if (!target) {
    console.log('\nNo unique {eventId, userId} index found.');
    console.log('Mongoose will create the correct one on next boot.');
    await mongoose.disconnect();
    return;
  }

  const isCorrect =
    JSON.stringify(target.partialFilterExpression ?? null) ===
    JSON.stringify(WANTED_PARTIAL);

  if (isCorrect) {
    console.log(`\n✅ '${target.name}' already has the partial filter.`);
    console.log('The index is NOT the cause — look elsewhere.');
    await mongoose.disconnect();
    return;
  }

  // Counting first makes the impact concrete rather than theoretical.
  const guests = await col.countDocuments({ userId: { $exists: false } });
  const guestsNull = await col.countDocuments({ userId: null });

  console.log(`\n❌ '${target.name}' is unique WITHOUT the partial filter.`);
  console.log('   Every guest row collides on (eventId, null), so only the');
  console.log('   FIRST guest on an event can ever be inserted.');
  console.log(`   Guest rows with no userId field: ${guests}`);
  console.log(`   Guest rows with userId null    : ${guestsNull}`);

  if (!APPLY) {
    console.log('\nWould drop and recreate it. Re-run with --apply.');
    await mongoose.disconnect();
    return;
  }

  console.log(`\nDropping '${target.name}'...`);
  await col.dropIndex(target.name as string);

  console.log('Creating the partial unique index...');
  // Built in the same run rather than left to the next boot: between the drop
  // and a restart there would be NO uniqueness rule at all, and a duplicate
  // registered player could slip in.
  await col.createIndex(KEY, {
    unique: true,
    partialFilterExpression: WANTED_PARTIAL,
  });

  const after = await col.indexes();
  const fixed = after.find(
    (index) => sameKey(index.key as Record<string, unknown>, KEY) && index.unique,
  );
  console.log('\n--- After ---');
  console.log(
    `  ${fixed?.name}: ${JSON.stringify(fixed?.key)} UNIQUE partial=${JSON.stringify(
      fixed?.partialFilterExpression,
    )}`,
  );
  console.log('\n✅ Done. A second guest can now be added.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
