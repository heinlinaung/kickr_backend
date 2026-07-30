// src/locations/schemas/location.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type LocationDocument = HydratedDocument<Location>;

export interface LocationGeo {
  type: 'Point';
  coordinates: [number, number];
}

@Schema({ timestamps: true })
export class Location {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, type: Number })
  lat: number;

  @Prop({ required: true, type: Number })
  lng: number;

  // Derived from lat/lng by the pre-validate hook below. Never client-settable.
  @Prop({ type: Object })
  geo: LocationGeo;

  @Prop()
  url?: string;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  createdBy: Types.ObjectId;
}

export const LocationSchema = SchemaFactory.createForClass(Location);

// Keep the GeoJSON point in sync with the authored lat/lng so they can never drift.
LocationSchema.pre('validate', function () {
  const doc = this as any;
  if (typeof doc.lat === 'number' && typeof doc.lng === 'number') {
    doc.geo = { type: 'Point', coordinates: [doc.lng, doc.lat] };
  }
});

LocationSchema.index({ geo: '2dsphere' });
LocationSchema.index({ name: 1 });
