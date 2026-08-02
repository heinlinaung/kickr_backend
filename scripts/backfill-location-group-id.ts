/**
 * Backfill `Location.groupId` for locations that predate group-owned locations.
 *
 * WHY
 * ---
 * `groupId` was added so a group's owner/admin/captain can manage the venues
 * their group uses. Rows created before that change have `groupId: null`
 * (i.e. "personal"), so even locations already attached to a group can only be
 * edited by whoever created them. This script assigns the owning group.
 *
 * RULES
 * -----
 * - A location referenced by EXACTLY ONE group  -> set groupId to that group.
 * - Referenced by MORE THAN ONE group           -> SKIPPED and reported.
 *   Ownership would be ambiguous, and silently picking one could hand the wrong
 *   group edit rights. Resolve those by hand.
 * - Referenced by NO group                      -> left personal (correct).
 * - Group references a DELETED location          -> the dead id is pulled out
 *   of the group (leftover from before deletes cleaned up their references).
 * - Already has a groupId                       -> untouched (idempotent).
 *
 * USAGE
 * -----
 *   # dry run (default — reports what WOULD change, writes nothing)
 *   npx ts-node scripts/backfill-location-group-id.ts
 *
 *   # apply
 *   npx ts-node scripts/backfill-location-group-id.ts --apply
 *
 * Reads MONGODB_URI from .env. Safe to re-run.
 */
import { config as loadEnv } from 'dotenv';
import mongoose from 'mongoose';

loadEnv();

const APPLY = process.argv.includes('--apply');

type Id = mongoose.Types.ObjectId;

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set (check your .env)');
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database handle after connecting');

  const groups = db.collection('groups');
  const locations = db.collection('locations');

  console.log(
    APPLY
      ? '=== APPLYING changes ==='
      : '=== DRY RUN (no writes) — pass --apply to commit ===',
  );

  // Build locationId -> [groupId] from every group's `locations` array.
  const usage = new Map<string, Id[]>();
  const cursor = groups.find(
    { locations: { $exists: true, $ne: [] } },
    { projection: { _id: 1, locations: 1, name: 1 } },
  );

  for await (const group of cursor) {
    for (const locId of (group.locations ?? []) as Id[]) {
      const key = locId.toString();
      const list = usage.get(key) ?? [];
      list.push(group._id as Id);
      usage.set(key, list);
    }
  }

  console.log(`Locations referenced by at least one group: ${usage.size}`);

  let updated = 0;
  let alreadySet = 0;
  let ambiguous = 0;
  let missing = 0;
  const ambiguousRows: string[] = [];

  for (const [locIdStr, groupIds] of usage) {
    const locId = new mongoose.Types.ObjectId(locIdStr);
    const loc = await locations.findOne(
      { _id: locId },
      { projection: { _id: 1, name: 1, groupId: 1 } },
    );

    if (!loc) {
      // A group references a location row that no longer exists — a leftover
      // from before deletes cleaned up their references. Purge the dead id so
      // it stops counting toward the 5-location cap.
      missing++;
      console.warn(
        `  ! dangling ref ${locIdStr} (location deleted) — removing from ${groupIds.length} group(s)`,
      );
      if (APPLY) {
        // cast only at the driver boundary: $pull's PullOperator typing is
        // awkward against an untyped Document collection
        await groups.updateMany({ locations: locId }, {
          $pull: { locations: locId },
        } as unknown as Record<string, unknown>);
      }
      continue;
    }

    if (loc.groupId) {
      alreadySet++;
      continue;
    }

    const distinct = [...new Set(groupIds.map((g) => g.toString()))];
    if (distinct.length > 1) {
      ambiguous++;
      ambiguousRows.push(
        `  ? "${loc.name}" (${locIdStr}) is used by ${distinct.length} groups: ${distinct.join(', ')}`,
      );
      continue;
    }

    const owningGroup = new mongoose.Types.ObjectId(distinct[0]);
    console.log(`  -> "${loc.name}" (${locIdStr})  groupId = ${distinct[0]}`);
    if (APPLY) {
      await locations.updateOne(
        { _id: locId },
        { $set: { groupId: owningGroup } },
      );
    }
    updated++;
  }

  if (ambiguousRows.length) {
    console.log('\nSKIPPED — used by multiple groups, assign manually:');
    ambiguousRows.forEach((r) => console.log(r));
  }

  console.log('\n--- summary ---');
  console.log(`  ${APPLY ? 'updated' : 'would update'} : ${updated}`);
  console.log(`  already had groupId : ${alreadySet}`);
  console.log(`  skipped (ambiguous) : ${ambiguous}`);
  console.log(`  dangling refs purged: ${missing}`);
  if (!APPLY && updated > 0) {
    console.log('\nRe-run with --apply to commit these changes.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
