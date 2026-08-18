/**
 * Move events off the removed `before_match` status.
 *
 * WHY
 * ---
 * `before_match` sat between `join` and `preparation` without gating anything
 * of its own — the same actions were permitted either side of it — so it was
 * removed from the lifecycle enum. Existing documents may still hold it, and
 * the new enum does **not** accept the value: such an event would fail
 * validation on its next save, and `canTransition` would refuse every move out
 * of it, stranding the event permanently.
 *
 * MAPPING
 * -------
 *   before_match -> preparation
 *
 * Forward, not back to `join`. `before_match` meant "registration closed", and
 * `preparation` is the state that now carries that: join/leave are refused
 * there. Sending them back to `join` would silently REOPEN registration on
 * events the organizer had deliberately closed.
 *
 * USAGE
 * -----
 *   # dry run (default — reports what WOULD change, writes nothing)
 *   npx ts-node scripts/migrate-remove-before-match.ts
 *
 *   # apply
 *   npx ts-node scripts/migrate-remove-before-match.ts --apply
 *
 * Reads MONGODB_URI from .env. Safe to re-run: once no document holds
 * `before_match` a second pass reports nothing to migrate.
 *
 * COORDINATE BEFORE RUNNING: a client that string-matches `"before_match"` or
 * offers it as a status option will break — the API now rejects it with a 400.
 */
import { config as loadEnv } from 'dotenv';
import mongoose from 'mongoose';

loadEnv();

const APPLY = process.argv.includes('--apply');

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

  const affected = await events
    .find(
      { status: 'before_match' },
      { projection: { _id: 1, title: 1, date: 1 } },
    )
    .toArray();

  console.log(`Events still in before_match: ${affected.length}`);
  if (!affected.length) {
    console.log('Nothing to migrate.');
    await mongoose.disconnect();
    return;
  }

  for (const event of affected) {
    console.log(
      `  ${event._id.toString()} (${String(event.title ?? 'untitled')}) : ` +
        'before_match -> preparation',
    );
  }

  if (APPLY) {
    const res = await events.updateMany(
      { status: 'before_match' },
      { $set: { status: 'preparation' } },
    );
    console.log(`\nUpdated ${res.modifiedCount} event(s).`);
  } else {
    console.log('\nDry run only. Re-run with --apply to commit.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
