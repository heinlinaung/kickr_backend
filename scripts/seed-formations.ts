/**
 * Seed the `formations` collection — the suggested formations per squad size
 * that `GET /formations` serves to the client's formation picker.
 *
 * Suggestions only: `PUT /events/:id/teams/:teamId/formation` is free-form
 * and validates arithmetic, not membership of this list, so editing this
 * list never blocks (or unblocks) anyone's line-up.
 *
 * IDEMPOTENT
 * ----------
 * Matches on `playerCount` and upserts, so re-running:
 *   - inserts anything missing,
 *   - refreshes `name`/`formation` on rows that exist,
 *   - never duplicates a squad size (`playerCount` is uniquely indexed).
 *
 * Rows in the collection but NOT in this list are reported and left alone.
 *
 * USAGE
 * -----
 *   # dry run (default — reports what WOULD change, writes nothing)
 *   npx ts-node scripts/seed-formations.ts
 *
 *   # apply
 *   npx ts-node scripts/seed-formations.ts --apply
 *
 * Reads MONGODB_URI from .env. Safe to re-run.
 */
import { config as loadEnv } from 'dotenv';
import mongoose from 'mongoose';

loadEnv();

const APPLY = process.argv.includes('--apply');

const FORMATIONS: {
  name: string;
  playerCount: number;
  formation: string[];
}[] = [
  {
    name: '5P Formation',
    playerCount: 5,
    formation: ['2-2', '1-2-1', '2-1-1', '1-1-2'],
  },
  {
    name: '6P Formation',
    playerCount: 6,
    formation: ['2-2-1', '1-3-1', '2-1-2', '1-2-2'],
  },
  {
    name: '7P Formation',
    playerCount: 7,
    formation: ['2-3-1', '3-2-1', '2-2-2', '3-1-2', '1-3-2'],
  },
  {
    name: '8P Formation',
    playerCount: 8,
    formation: ['3-3-1', '2-3-2', '3-2-2', '2-4-1', '3-1-3'],
  },
  {
    name: '11P Formation',
    playerCount: 11,
    formation: [
      '4-4-2',
      '4-3-3',
      '3-5-2',
      '4-2-3',
      '3-4-3',
      '3-3-4',
      '5-3-2',
      '5-4-1',
    ],
  },
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

  console.log(`Target: ${uri.replace(/\/\/[^@]*@/, '//<redacted>@')}`);
  console.log(
    APPLY
      ? '=== APPLYING changes ==='
      : '=== DRY RUN (no writes) — pass --apply to commit ===',
  );

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database handle after connect');
  const col = db.collection('formations');

  const existing = await col.find({}).toArray();
  const byCount = new Map(existing.map((row) => [Number(row.playerCount), row]));

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const row of FORMATIONS) {
    const current = byCount.get(row.playerCount);

    if (!current) {
      console.log(
        `+ insert  ${row.playerCount}P (${row.formation.length} formations)`,
      );
      if (APPLY) {
        const now = new Date();
        await col.insertOne({ ...row, createdAt: now, updatedAt: now });
      }
      inserted += 1;
      continue;
    }

    if (
      current.name !== row.name ||
      !sameStringArray(current.formation, row.formation)
    ) {
      console.log(
        `~ update  ${row.playerCount}P: [${String(current.formation)}] -> ` +
          `[${row.formation.join(', ')}]`,
      );
      if (APPLY) {
        await col.updateOne(
          { _id: current._id },
          {
            $set: {
              name: row.name,
              formation: row.formation,
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

  const known = new Set(FORMATIONS.map((row) => row.playerCount));
  for (const row of existing) {
    if (!known.has(Number(row.playerCount))) {
      console.log(
        `? not in seed list (left alone): ${String(row.playerCount)}P`,
      );
    }
  }

  console.log(
    `${APPLY ? 'Applied' : 'Would apply'}: ` +
      `${inserted} insert(s), ${updated} update(s), ${unchanged} unchanged.`,
  );

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
