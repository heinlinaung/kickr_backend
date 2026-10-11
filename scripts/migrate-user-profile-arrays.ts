/**
 * Migrate `users.preferredSport` and `users.footballPosition` from single
 * strings to arrays of strings (2026-10-11).
 *
 * Mapping, per field:
 *   "football"      -> ["football"]
 *   "" / null       -> []
 *   missing         -> left missing (the schema default [] applies on write)
 *   already an array -> untouched, so the script is safe to re-run
 *
 * USAGE
 * -----
 *   npx ts-node scripts/migrate-user-profile-arrays.ts          # dry run
 *   npx ts-node scripts/migrate-user-profile-arrays.ts --apply
 *
 * Reads MONGODB_URI from .env.
 */
import { config as loadEnv } from 'dotenv';
import mongoose from 'mongoose';

loadEnv();

const APPLY = process.argv.includes('--apply');
const FIELDS = ['preferredSport', 'footballPosition'] as const;

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
  const col = db.collection('users');

  let updated = 0;
  for (const field of FIELDS) {
    // Strings only — arrays are the target shape and stay untouched.
    const rows = await col
      .find({ [field]: { $type: 'string' } })
      .project({ [field]: 1 })
      .toArray();

    for (const row of rows) {
      const value = row[field] as string;
      const wrapped = value.trim() === '' ? [] : [value];
      console.log(
        `~ ${field}  user ${String(row._id)}: '${value}' -> [${wrapped
          .map((v) => `'${v}'`)
          .join(', ')}]`,
      );
      if (APPLY) {
        await col.updateOne({ _id: row._id }, { $set: { [field]: wrapped } });
      }
      updated += 1;
    }
  }

  // Null values read fine as "unset", but normalising them to [] keeps one
  // shape on the wire. $type 'null' matches stored nulls only, never missing
  // fields — `{ [field]: null }` would match those too and bloat every doc.
  for (const field of FIELDS) {
    const nullFilter = { [field]: { $type: 'null' } };
    const nulls = await col.countDocuments(nullFilter);
    if (nulls > 0) {
      console.log(`~ ${field}  ${nulls} null value(s) -> []`);
      if (APPLY) {
        await col.updateMany(nullFilter, { $set: { [field]: [] } });
      }
      updated += nulls;
    }
  }

  console.log(
    `${APPLY ? 'Applied' : 'Would apply'}: ${updated} field value(s) wrapped.`,
  );

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
