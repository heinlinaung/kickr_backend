/**
 * Migrate `eventpayments` rows from the organizer-marking model
 * ({isPaid, paidAt, recordedBy}) to the submit/review model
 * ({method, status, proof*, submittedAt, reviewedBy, reviewedAt,
 * rejectReason}) introduced 2026-10-03.
 *
 * Mapping:
 *   isPaid: true  -> method 'cash', status 'approved',
 *                    reviewedBy <- recordedBy, reviewedAt <- paidAt,
 *                    submittedAt <- paidAt (the mark was the whole flow)
 *   isPaid: false -> row DELETED. The old model stored "recorded as unpaid"
 *                    explicitly; the new model represents unpaid as the
 *                    ABSENCE of a row, so keeping these would read as
 *                    pending submissions that never happened.
 *
 * Rows already carrying a `status` (new-model rows) are left untouched, so
 * the script is safe to re-run.
 *
 * USAGE
 * -----
 *   npx ts-node scripts/migrate-event-payments.ts          # dry run
 *   npx ts-node scripts/migrate-event-payments.ts --apply
 *
 * Reads MONGODB_URI from .env.
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
      : '=== DRY RUN (no writes) — pass --apply to commit ===',
  );

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database handle after connect');
  const col = db.collection('eventpayments');

  // Old-model rows are exactly those without a status.
  const legacy = await col.find({ status: { $exists: false } }).toArray();
  let approved = 0;
  let deleted = 0;

  for (const row of legacy) {
    if (row.isPaid === true) {
      console.log(
        `~ approve  event ${String(row.eventId)} member ${String(row.memberId)}`,
      );
      if (APPLY) {
        await col.updateOne(
          { _id: row._id },
          {
            $set: {
              method: 'cash',
              status: 'approved',
              proofUrl: null,
              proofFileId: null,
              submittedAt: row.paidAt ?? row.createdAt ?? new Date(),
              reviewedBy: row.recordedBy ?? null,
              reviewedAt: row.paidAt ?? new Date(),
              rejectReason: null,
              updatedAt: new Date(),
            },
            $unset: { isPaid: '', paidAt: '', recordedBy: '' },
          },
        );
      }
      approved += 1;
    } else {
      console.log(
        `- delete   event ${String(row.eventId)} member ${String(row.memberId)} (recorded unpaid)`,
      );
      if (APPLY) await col.deleteOne({ _id: row._id });
      deleted += 1;
    }
  }

  console.log(
    `${APPLY ? 'Applied' : 'Would apply'}: ${approved} converted to ` +
      `approved-cash, ${deleted} unpaid row(s) removed, ` +
      `${legacy.length === 0 ? 'nothing legacy found' : `${legacy.length} legacy total`}.`,
  );

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
