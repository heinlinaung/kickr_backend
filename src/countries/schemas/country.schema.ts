// src/countries/schemas/country.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CountryDocument = HydratedDocument<Country>;

/**
 * A region (city) inside a country. `id` is the value groups and users store
 * as `city`, e.g. 'yangon' or 'chiang mai'; `name` is what clients display.
 *
 * `id: false` turns off Mongoose's built-in `id` virtual so the real `id`
 * path is not shadowed by it.
 */
@Schema({ _id: false, id: false })
export class Region {
  @Prop({ required: true, trim: true, lowercase: true })
  id: string;

  @Prop({ required: true, trim: true })
  name: string;
}

export const RegionSchema = SchemaFactory.createForClass(Region);

/**
 * A country and its regions — reference data for the country/city pickers.
 *
 * Seeded by `scripts/seed-countries.ts` and maintained through the
 * superadmin-only write endpoints on /countries.
 *
 * Groups and users store the plain `id` strings (`country: 'myanmar'`,
 * `city: 'yangon'`), not ObjectId refs — same approach as sport types. That
 * is why ids are immutable once created: renaming one would strand every
 * document already carrying the old string. Only `name` can change.
 *
 * Regions are embedded rather than their own collection: a country has a
 * handful of them and they are always read together.
 */
@Schema({ timestamps: true, collection: 'countries', id: false })
export class Country {
  /** e.g. 'myanmar'. Unique and lowercased, matching Group/User.country. */
  @Prop({ required: true, unique: true, trim: true, lowercase: true })
  id: string;

  @Prop({ required: true, trim: true })
  name: string;

  /** Display position, driving the default ordering. */
  @Prop({ required: true })
  sortOrder: number;

  /** In display order. Region ids are unique within a country. */
  @Prop({ type: [RegionSchema], default: [] })
  regions: Region[];
}

export const CountrySchema = SchemaFactory.createForClass(Country);

/** Serves the only list query: everything, in display order. */
CountrySchema.index({ sortOrder: 1, id: 1 });
