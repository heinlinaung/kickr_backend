/**
 * Move embedded `Event.matches[]` into the standalone `eventmatches` collection.
 *
 * WHY
 * ---
 * Fixtures were embedded on Event as a subdocument array with `_id: false`,
 * which is fine for reading a fixture list but gives nothing durable for
 * another collection to point at. Player ratings (spec §8) hang off a specific
 * match, so each fixture needs a stable `_id` of its own.
 *
 * WHAT IT DOES
 * ------------
 * For every event carrying a non-empty `matches` array:
 *   1. inserts one `eventmatches` row per fixture, preserving matchNumber,
 *      teamA/teamB, scoreA/scoreB and playedAt exactly;
 *   2. unsets the embedded `matches` field on the event.
 *
 * USAGE
 * -----
 *   # dry run (default — reports what WOULD change, writes nothing)
 *   npx ts-node scripts/extract-event-matches.ts
 *
 *   # apply
 *   npx ts-node scripts/extract-event-matches.ts --apply
 *
 * Reads MONGODB_URI from .env.
 *
 * SAFE TO RE-RUN. An event whose fixtures are already extracted no longer has
 * an embedded `matches` array, so it is skipped. If a run is interrupted after
 * inserting but before unsetting, re-running would double-insert — so the
 * insert step skips any event that ALREADY has rows in `eventmatches`, and
 * such events are reported as conflicts rather than silently merged.
 *
 * COORDINATE BEFORE RUNNING: `GET /events/:id` no longer returns `matches` from
 * the event document itself; the API attaches it from the new collection. A
 * client reading `event.matches` keeps working, but only after this runs.
 */
import { config as loadEnv } from 'dotenv';
import mongoose from 'mongoose';

loadEnv();

const APPLY = process.argv.includes('--apply');

interface EmbeddedMatch {
  matchNumber: number;
  teamA: string;
  teamB: string;
  scoreA: number | null;
  scoreB: number | null;
  playedAt: Date | null;
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set (check your .env)');
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database handle after connecting');

  const events = db.collection('events');
  const matches = db.collection('eventmatches');

  console.log(
    APPLY
      ? '=== APPLYING changes ==='
      : '=== DRY RUN (no writes) — pass --apply to commit ===',
  );

  const candidates = await events
    .find(
      { matches: { $exists: true, $ne: [] } },
      { projection: { _id: 1, title: 1, matches: 1 } },
    )
    .toArray();

  console.log(`Events with embedded fixtures: ${candidates.length}`);
  if (!candidates.length) {
    console.log('Nothing to migrate.');
    await mongoose.disconnect();
    return;
  }

  let movedEvents = 0;
  let movedFixtures = 0;
  const conflicts: string[] = [];

  for (const event of candidates) {
    const embedded = (event.matches ?? []) as EmbeddedMatch[];
    if (!embedded.length) continue;

    // Guard against a half-finished previous run: if rows already exist for
    // this event, inserting again would duplicate the fixture list.
    const existing = await matches.countDocuments({ eventId: event._id });
    if (existing > 0) {
      conflicts.push(
        `${event._id.toString()} (${String(event.title ?? 'untitled')}) — ` +
          `${existing} row(s) already in eventmatches, ${embedded.length} still embedded`,
      );
      continue;
    }

    const now = new Date();
    const rows = embedded.map((fixture) => ({
      eventId: event._id,
      matchNumber: fixture.matchNumber,
      teamA: fixture.teamA,
      teamB: fixture.teamB,
      // ?? null, not || null: 0 is a real scoreline and must survive.
      scoreA: fixture.scoreA ?? null,
      scoreB: fixture.scoreB ?? null,
      playedAt: fixture.playedAt ?? null,
      createdAt: now,
      updatedAt: now,
    }));

    console.log(
      `  ${event._id.toString()} (${String(event.title ?? 'untitled')}) : ` +
        `${rows.length} fixture(s)`,
    );

    if (APPLY) {
      await matches.insertMany(rows);
      await events.updateOne({ _id: event._id }, { $unset: { matches: '' } });
    }

    movedEvents += 1;
    movedFixtures += rows.length;
  }

  console.log('\n--- Summary ---');
  console.log(`Events migrated : ${movedEvents}`);
  console.log(`Fixtures moved  : ${movedFixtures}`);

  if (conflicts.length) {
    console.log(`\n⚠️  Skipped ${conflicts.length} event(s) with existing rows:`);
    for (const line of conflicts) console.log(`     ${line}`);
    console.log(
      '     These need a manual look — most likely an interrupted earlier run.',
    );
  }

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to commit.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
