/**
 * Rename `Group.teamRules` -> `Group.rules`.
 *
 * WHY
 * ---
 * The field was called `teamRules` in the schema while the API surface, the
 * docs and the (now removed) routes all said "rules". The schema field was
 * renamed to `rules` so the stored name matches the API. Documents written
 * before that change still carry `teamRules`, which the new schema does not
 * read — so those groups would silently appear to have no rules.
 *
 * RULES
 * -----
 * - Has `teamRules` and NO `rules`        -> renamed.
 * - Has BOTH                              -> SKIPPED and reported. Renaming
 *   would overwrite the newer `rules` value; resolve those by hand.
 * - Has neither, or only `rules`          -> untouched (idempotent).
 *
 * USAGE
 * -----
 *   # dry run (default — reports what WOULD change, writes nothing)
 *   npx ts-node scripts/rename-group-team-rules.ts
 *
 *   # apply
 *   npx ts-node scripts/rename-group-team-rules.ts --apply
 *
 * Reads MONGODB_URI from .env. Safe to re-run.
 */
import { config as loadEnv } from 'dotenv';
import mongoose from 'mongoose';

loadEnv();

const APPLY = process.argv.includes('--apply');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set (check .env)');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const groups = mongoose.connection.collection('groups');

  // Both fields present: ambiguous, never touched automatically.
  const conflicts = await groups
    .find(
      {
        teamRules: { $exists: true },
        rules: { $exists: true },
      },
      { projection: { _id: 1, name: 1, teamRules: 1, rules: 1 } },
    )
    .toArray();

  // The actual work: old field present, new field absent.
  const pending = await groups
    .find(
      {
        teamRules: { $exists: true },
        rules: { $exists: false },
      },
      { projection: { _id: 1, name: 1, teamRules: 1 } },
    )
    .toArray();

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — rename teamRules -> rules\n`);
  console.log(`to rename: ${pending.length}`);
  console.log(`conflicts (both fields, skipped): ${conflicts.length}\n`);

  for (const g of pending) {
    const count = Array.isArray(g.teamRules) ? g.teamRules.length : 0;
    console.log(
      `  ${String(g._id)}  ${g.name ?? '(unnamed)'} — ${count} rule(s)`,
    );
  }

  if (conflicts.length) {
    console.log('\nSKIPPED — both `teamRules` and `rules` set:');
    for (const g of conflicts) {
      console.log(
        `  ${String(g._id)}  ${g.name ?? '(unnamed)'} — ` +
          `teamRules: ${JSON.stringify(g.teamRules)} | rules: ${JSON.stringify(g.rules)}`,
      );
    }
    console.log('Resolve these by hand, then re-run.');
  }

  if (!APPLY) {
    console.log(
      '\nNothing written. Re-run with --apply to perform the rename.',
    );
    await mongoose.disconnect();
    return;
  }

  if (pending.length) {
    // $rename moves the value and drops the old key in one operation.
    const res = await groups.updateMany(
      { teamRules: { $exists: true }, rules: { $exists: false } },
      { $rename: { teamRules: 'rules' } },
    );
    console.log(`\nrenamed: ${res.modifiedCount}`);
  } else {
    console.log('\nnothing to rename');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
