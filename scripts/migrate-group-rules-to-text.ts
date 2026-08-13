/**
 * Convert `Group.rules` from `string[]` to a single text block.
 *
 * WHY
 * ---
 * Rules were an array of strings, one entry per rule, so the API imposed a
 * bullet structure on the client. They are now free-form text: the client owns
 * presentation entirely, and multi-line rules no longer need a nested newline
 * convention.
 *
 * MAPPING
 * -------
 *   ["No smoking", "Be on time"]  ->  "No smoking\nBe on time"
 *   []                            ->  ""
 *   already a string              ->  left alone
 *
 * Entries are joined with a single newline. Interior newlines inside an entry
 * survive untouched, so a rule that already spanned lines keeps its shape.
 *
 * USAGE
 * -----
 *   # dry run (default — reports what WOULD change, writes nothing)
 *   npx ts-node scripts/migrate-group-rules-to-text.ts
 *
 *   # apply
 *   npx ts-node scripts/migrate-group-rules-to-text.ts --apply
 *
 * Reads MONGODB_URI from .env. Safe to re-run: a group whose `rules` is already
 * a string is skipped, so a second pass is a no-op.
 *
 * COORDINATE BEFORE RUNNING: any client reading `rules` as an array breaks —
 * it becomes a string in every response. Ship the client change together.
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

  const groups = db.collection('groups');

  console.log(
    APPLY
      ? '=== APPLYING changes ==='
      : '=== DRY RUN (no writes) — pass --apply to commit ===',
  );

  // $type: 'array' rather than a JS-side check: only documents still holding
  // the old shape are candidates, so a re-run naturally finds nothing.
  const candidates = await groups
    .find(
      { rules: { $type: 'array' } },
      { projection: { _id: 1, name: 1, rules: 1 } },
    )
    .toArray();

  console.log(`Groups with array rules: ${candidates.length}`);
  if (!candidates.length) {
    console.log('Nothing to migrate.');
    await mongoose.disconnect();
    return;
  }

  let converted = 0;
  let emptied = 0;

  for (const group of candidates) {
    const entries = (group.rules ?? []) as unknown[];
    const text = entries
      .filter((e) => typeof e === 'string')
      .join('\n');

    const label = String(group.name ?? 'unnamed');
    if (!text) {
      console.log(`  ${group._id.toString()} (${label}) : [] -> ""`);
      emptied += 1;
    } else {
      const preview = text.split('\n')[0].slice(0, 48);
      console.log(
        `  ${group._id.toString()} (${label}) : ${entries.length} entr(ies) -> ` +
          `"${preview}${text.length > preview.length ? '…' : ''}"`,
      );
      converted += 1;
    }

    if (APPLY) {
      await groups.updateOne({ _id: group._id }, { $set: { rules: text } });
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Converted to text : ${converted}`);
  console.log(`Empty arrays      : ${emptied}`);

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to commit.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
