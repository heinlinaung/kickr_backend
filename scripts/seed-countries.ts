/**
 * Seed the `countries` collection — countries and their regions, the source
 * for the country/city pickers (`GET /countries`, `GET /regions`).
 *
 * Ids match the lowercase `country` / `city` values groups and users already
 * store, e.g. country 'myanmar', region 'yangon'.
 *
 * IDEMPOTENT
 * ----------
 * Matches on `id` and upserts, so re-running:
 *   - inserts missing countries,
 *   - refreshes `name` / `sortOrder` on countries that exist,
 *   - appends missing regions and refreshes region names, keeping any region
 *     a superadmin added that is not in this list,
 *   - never duplicates a country (`id` is uniquely indexed).
 *
 * Nothing is ever deleted — a country or region could already be stored on
 * groups or users. Countries in the DB but not in this list are reported.
 *
 * USAGE
 * -----
 *   # dry run (default — reports what WOULD change, writes nothing)
 *   npx ts-node scripts/seed-countries.ts
 *
 *   # apply
 *   npx ts-node scripts/seed-countries.ts --apply
 *
 * Reads MONGODB_URI from .env. Safe to re-run.
 */
import { config as loadEnv } from 'dotenv';
import mongoose from 'mongoose';

loadEnv();

const APPLY = process.argv.includes('--apply');

type Region = { id: string; name: string };

const COUNTRIES: {
  id: string;
  name: string;
  sortOrder: number;
  regions: Region[];
}[] = [
  {
    id: 'myanmar',
    name: 'Myanmar',
    sortOrder: 1,
    regions: [
      { id: 'yangon', name: 'Yangon' },
      { id: 'mandalay', name: 'Mandalay' },
      { id: 'naypyitaw', name: 'Naypyitaw' },
      { id: 'bago', name: 'Bago' },
      { id: 'mawlamyine', name: 'Mawlamyine' },
      { id: 'monywa', name: 'Monywa' },
      { id: 'pathein', name: 'Pathein' },
      { id: 'sittwe', name: 'Sittwe' },
      { id: 'taunggyi', name: 'Taunggyi' },
    ],
  },
  {
    id: 'thailand',
    name: 'Thailand',
    sortOrder: 2,
    regions: [
      { id: 'bangkok', name: 'Bangkok' },
      { id: 'chiang mai', name: 'Chiang Mai' },
      { id: 'phuket', name: 'Phuket' },
      { id: 'pattaya', name: 'Pattaya' },
      { id: 'nonthaburi', name: 'Nonthaburi' },
      { id: 'nakhon ratchasima', name: 'Nakhon Ratchasima' },
    ],
  },
  {
    id: 'singapore',
    name: 'Singapore',
    sortOrder: 3,
    regions: [{ id: 'singapore', name: 'Singapore' }],
  },
  {
    id: 'vietnam',
    name: 'Vietnam',
    sortOrder: 4,
    regions: [
      { id: 'ho chi minh city', name: 'Ho Chi Minh City' },
      { id: 'hanoi', name: 'Hanoi' },
      { id: 'da nang', name: 'Da Nang' },
      { id: 'hai phong', name: 'Hai Phong' },
      { id: 'can tho', name: 'Can Tho' },
    ],
  },
  {
    id: 'malaysia',
    name: 'Malaysia',
    sortOrder: 5,
    regions: [
      { id: 'kuala lumpur', name: 'Kuala Lumpur' },
      { id: 'george town', name: 'George Town' },
      { id: 'johor bahru', name: 'Johor Bahru' },
      { id: 'ipoh', name: 'Ipoh' },
      { id: 'malacca city', name: 'Malacca City' },
    ],
  },
  {
    id: 'japan',
    name: 'Japan',
    sortOrder: 6,
    regions: [
      { id: 'tokyo', name: 'Tokyo' },
      { id: 'osaka', name: 'Osaka' },
      { id: 'kyoto', name: 'Kyoto' },
      { id: 'yokohama', name: 'Yokohama' },
      { id: 'nagoya', name: 'Nagoya' },
      { id: 'sapporo', name: 'Sapporo' },
    ],
  },
  {
    id: 'australia',
    name: 'Australia',
    sortOrder: 7,
    regions: [
      { id: 'sydney', name: 'Sydney' },
      { id: 'melbourne', name: 'Melbourne' },
      { id: 'brisbane', name: 'Brisbane' },
      { id: 'perth', name: 'Perth' },
      { id: 'adelaide', name: 'Adelaide' },
      { id: 'canberra', name: 'Canberra' },
    ],
  },
];

/**
 * Seed regions in seed order with their seeded names, followed by any extra
 * regions already in the DB (kept, never dropped).
 */
function mergeRegions(current: Region[], seed: Region[]): Region[] {
  const seedIds = new Set(seed.map((r) => r.id));
  return [...seed, ...current.filter((r) => !seedIds.has(r.id))];
}

function sameRegions(a: Region[], b: Region[]): boolean {
  return (
    a.length === b.length &&
    a.every((r, i) => r.id === b[i].id && r.name === b[i].name)
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
  const col = db.collection('countries');

  const existing = await col.find({}).toArray();
  const byId = new Map(existing.map((row) => [String(row.id), row]));

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const country of COUNTRIES) {
    const current = byId.get(country.id);

    if (!current) {
      console.log(
        `+ insert  ${country.id} (${country.regions.length} regions, ` +
          `sortOrder ${country.sortOrder})`,
      );
      if (APPLY) {
        const now = new Date();
        await col.insertOne({ ...country, createdAt: now, updatedAt: now });
      }
      inserted += 1;
      continue;
    }

    const currentRegions: Region[] = (current.regions ?? []).map(
      (r: Region) => ({ id: r.id, name: r.name }),
    );
    const regions = mergeRegions(currentRegions, country.regions);

    if (
      current.name !== country.name ||
      current.sortOrder !== country.sortOrder ||
      !sameRegions(currentRegions, regions)
    ) {
      console.log(
        `~ update  ${country.id}: name ${String(current.name)} -> ` +
          `${country.name}, sortOrder ${String(current.sortOrder)} -> ` +
          `${country.sortOrder}, regions ${currentRegions.length} -> ` +
          `${regions.length}`,
      );
      if (APPLY) {
        await col.updateOne(
          { _id: current._id },
          {
            $set: {
              name: country.name,
              sortOrder: country.sortOrder,
              regions,
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

  const seeded = new Set(COUNTRIES.map((c) => c.id));
  const extra = existing.filter((row) => !seeded.has(String(row.id)));
  for (const row of extra) {
    console.log(
      `! in DB but not in the seed list: ${String(row.id)} (left alone)`,
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
