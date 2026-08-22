/**
 * Lowercase existing `country` / `city` values on Group and User.
 *
 * WHY
 * ---
 * Both fields are now stored lowercase (`lowercase: true` on the schema, plus a
 * DTO transform). Documents written before that keep whatever casing was typed,
 * and Mongoose only normalises on write — an untouched document stays "Yangon"
 * forever.
 *
 * That matters for `GET /events?region=`, which now does an exact match against
 * the canonical lowercase form so the `{country, city}` index can be used. A
 * group still holding "Yangon" is invisible to `?region=yangon` until this runs.
 *
 * USAGE
 * -----
 *   # dry run (default — reports what WOULD change, writes nothing)
 *   npx ts-node scripts/lowercase-country-city.ts
 *
 *   # apply
 *   npx ts-node scripts/lowercase-country-city.ts --apply
 *
 * Reads MONGODB_URI from .env. Safe to re-run: a value already lowercase is
 * skipped, so a second pass reports nothing to change.
 */
import { config as loadEnv } from 'dotenv';
import mongoose from 'mongoose';

loadEnv();

const APPLY = process.argv.includes('--apply');

interface Row {
  _id: unknown;
  country?: unknown;
  city?: unknown;
  name?: unknown;
  email?: unknown;
}

async function normalise(
  // Loosely typed on purpose: mongoose re-exports a Collection type that does
  // not match the driver's, and this script only needs find/updateOne.
  coll: {
    find: (q: unknown, o?: unknown) => { toArray: () => Promise<unknown[]> };
    updateOne: (q: unknown, u: unknown) => Promise<unknown>;
  },
  label: string,
  describe: (row: Row) => string,
): Promise<number> {
  // Only documents where at least one field is not already lowercase. Doing the
  // comparison in the query keeps a re-run from touching anything.
  const rows = (await coll
    .find(
      {
        $or: [
          { country: { $type: 'string', $ne: '' } },
          { city: { $type: 'string', $ne: '' } },
        ],
      },
      { projection: { _id: 1, country: 1, city: 1, name: 1, email: 1 } },
    )
    .toArray()) as unknown as Row[];

  let changed = 0;
  for (const row of rows) {
    const patch: Record<string, string> = {};
    for (const field of ['country', 'city'] as const) {
      const value = row[field];
      if (typeof value !== 'string') continue;
      const lower = value.trim().toLowerCase();
      if (lower !== value) patch[field] = lower;
    }
    if (!Object.keys(patch).length) continue;

    changed += 1;
    const before = ['country', 'city']
      .filter((f) => f in patch)
      .map((f) => `${f}: "${String(row[f as 'country' | 'city'])}" -> "${patch[f]}"`)
      .join(', ');
    console.log(`  ${label} ${String(row._id)} (${describe(row)}) : ${before}`);

    if (APPLY) await coll.updateOne({ _id: row._id }, { $set: patch });
  }
  return changed;
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set (check your .env)');

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database handle after connecting');

  console.log(
    APPLY
      ? '=== APPLYING changes ==='
      : '=== DRY RUN (no writes) — pass --apply to commit ===',
  );

  const groups = await normalise(db.collection('groups'), 'group', (r) =>
    String(r.name ?? 'unnamed'),
  );
  const users = await normalise(db.collection('users'), 'user', (r) =>
    String(r.email ?? 'no-email'),
  );

  console.log('\n--- Summary ---');
  console.log(`Groups changed : ${groups}`);
  console.log(`Users changed  : ${users}`);
  if (!groups && !users) console.log('Nothing to migrate.');
  if (!APPLY) console.log('\nDry run only. Re-run with --apply to commit.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
