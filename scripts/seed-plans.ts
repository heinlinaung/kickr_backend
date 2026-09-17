/**
 * Seed the `plans` collection — the subscription plans `User.plan` names and
 * the limits PlansService enforces.
 *
 * WHY
 * ---
 * The limits started as a code registry; they now live in the database so a
 * plan can be tuned or added without a deploy. Two plans:
 *
 *   default        2 groups owned, 3 events/week, 50 gallery photos/group —
 *                  what every user is on (User.plan defaults to 'default').
 *   no-limit-plan  every limit null = UNLIMITED. For testing and admin
 *                  accounts only; nothing assigns it — set User.plan by hand.
 *
 * `null` means unlimited by convention (PlansService resolves it to
 * Infinity). A MISSING field is not unlimited — the service falls back to the
 * default plan's value for it — so only an explicit null lifts a cap.
 *
 * An unseeded database is safe but strict: PlansService falls back to the
 * in-code DEFAULT_PLAN_LIMITS (which this seed must stay equal to for the
 * default row), and `no-limit-plan` users get DEFAULT limits until this runs.
 *
 * IDEMPOTENT
 * ----------
 * Matches on `name` and upserts, so re-running:
 *   - inserts anything missing,
 *   - refreshes limits on rows that exist (a tuned limit is reset to the
 *     seed's value — edit the seed, not the row),
 *   - never duplicates a plan (`name` is uniquely indexed).
 *
 * Plans in the collection but NOT in this list are reported and left alone —
 * users may still name them, and PlansService degrades an unknown name to
 * the default plan anyway.
 *
 * USAGE
 * -----
 *   # dry run (default — reports what WOULD change, writes nothing)
 *   npx ts-node scripts/seed-plans.ts
 *
 *   # apply
 *   npx ts-node scripts/seed-plans.ts --apply
 *
 * Reads MONGODB_URI from .env. Safe to re-run.
 */
import { config as loadEnv } from 'dotenv';
import mongoose from 'mongoose';

loadEnv();

const APPLY = process.argv.includes('--apply');

interface SeedPlan {
  name: string;
  maxGroupsOwned: number | null;
  maxEventsPerWeek: number | null;
  maxGalleryPhotosPerGroup: number | null;
}

const SEED_PLANS: SeedPlan[] = [
  {
    name: 'default',
    maxGroupsOwned: 2,
    maxEventsPerWeek: 3,
    maxGalleryPhotosPerGroup: 50,
  },
  {
    name: 'no-limit-plan',
    maxGroupsOwned: null,
    maxEventsPerWeek: null,
    maxGalleryPhotosPerGroup: null,
  },
];

const LIMIT_FIELDS = [
  'maxGroupsOwned',
  'maxEventsPerWeek',
  'maxGalleryPhotosPerGroup',
] as const;

const show = (v: number | null | undefined) =>
  v === null ? 'unlimited' : String(v);

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
  const col = db.collection('plans');

  const existing = await col.find({}).toArray();
  const byName = new Map(existing.map((row) => [String(row.name), row]));

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const plan of SEED_PLANS) {
    const current = byName.get(plan.name);

    if (!current) {
      console.log(
        `+ insert  ${plan.name} (` +
          LIMIT_FIELDS.map((f) => `${f}: ${show(plan[f])}`).join(', ') +
          ')',
      );
      if (APPLY) {
        const now = new Date();
        await col.insertOne({ ...plan, createdAt: now, updatedAt: now });
      }
      inserted += 1;
      continue;
    }

    const drifted = LIMIT_FIELDS.filter((f) => current[f] !== plan[f]);
    if (drifted.length > 0) {
      for (const f of drifted) {
        console.log(
          `~ update  ${plan.name}.${f}: ${show(current[f] as number | null)} -> ${show(plan[f])}`,
        );
      }
      if (APPLY) {
        const patch = Object.fromEntries(LIMIT_FIELDS.map((f) => [f, plan[f]]));
        await col.updateOne(
          { _id: current._id },
          { $set: { ...patch, updatedAt: new Date() } },
        );
      }
      updated += 1;
      continue;
    }

    unchanged += 1;
  }

  // Reported, never deleted: a user's plan string could still name one, and
  // PlansService degrades an unknown name to the default plan regardless.
  const seeded = new Set(SEED_PLANS.map((p) => p.name));
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
  if (!inserted && !updated) console.log('Nothing to do — already seeded.');
  if (!APPLY) console.log('\nDry run only. Re-run with --apply to commit.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
