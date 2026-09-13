/**
 * Reports any event still holding photos in the deprecated embedded
 * `event.photos` array, and optionally migrates them.
 *
 * WHY
 * ---
 * Photos moved to the shared `photos` collection on 2026-09-13. The move was
 * made without a migration because the owner reported no events currently hold
 * any — but that was a report, not a query. If it is wrong, those photos are
 * INVISIBLE through the new endpoints: the data is still in Mongo, and nothing
 * reads it.
 *
 * This turns that assumption into a check.
 *
 * USAGE
 * -----
 *   # report only (default — writes nothing)
 *   npx ts-node scripts/check-legacy-event-photos.ts
 *
 *   # copy any it finds into the photos collection
 *   npx ts-node scripts/check-legacy-event-photos.ts --apply
 *
 * Reads MONGODB_URI from .env. Safe to re-run: a photo already migrated is
 * matched by fileId and skipped.
 */
import { config as loadEnv } from 'dotenv';
import mongoose from 'mongoose';

loadEnv();

const APPLY = process.argv.includes('--apply');

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
      : '=== REPORT ONLY — pass --apply to migrate ===',
  );

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database handle after connect');

  const events = db.collection('events');
  const photos = db.collection('photos');

  const withPhotos = await events
    .find({ 'photos.0': { $exists: true } })
    .project({ _id: 1, title: 1, groupId: 1, createdBy: 1, photos: 1 })
    .toArray();

  if (!withPhotos.length) {
    console.log('\n✅ No event holds embedded photos.');
    console.log('The assumption behind skipping the migration holds.');
    console.log('`event.photos` can be dropped from the schema.');
    await mongoose.disconnect();
    return;
  }

  const total = withPhotos.reduce(
    (sum, e) => sum + ((e.photos as unknown[])?.length ?? 0),
    0,
  );
  console.log(
    `\n⚠️  ${withPhotos.length} event(s) hold ${total} embedded photo(s).`,
  );
  console.log('These are INVISIBLE through the new endpoints.\n');

  let migrated = 0;
  let skipped = 0;

  for (const event of withPhotos) {
    const list = (event.photos ?? []) as { url: string; fileId: string }[];
    console.log(`  ${String(event.title ?? event._id)}: ${list.length}`);

    for (const photo of list) {
      // Matched on fileId so a re-run does not duplicate.
      const exists = await photos.findOne({ fileId: photo.fileId });
      if (exists) {
        skipped += 1;
        continue;
      }
      if (APPLY) {
        const now = new Date();
        await photos.insertOne({
          targetType: 'event',
          targetId: event._id,
          // The denormalised link that puts it in the group gallery.
          groupId: event.groupId ?? null,
          url: photo.url,
          fileId: photo.fileId,
          // No uploader was ever recorded on the embedded shape, so the
          // event's creator is the closest honest answer.
          uploadedBy: event.createdBy,
          createdAt: now,
          updatedAt: now,
        });
      }
      migrated += 1;
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Would migrate : ${migrated}`);
  console.log(`Already there : ${skipped}`);
  if (!APPLY) console.log('\nReport only. Re-run with --apply to migrate.');
  else console.log('\n✅ Migrated. The embedded arrays were left in place.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
