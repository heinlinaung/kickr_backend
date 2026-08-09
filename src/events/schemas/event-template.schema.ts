// src/events/schemas/event-template.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type EventTemplateDocument = HydratedDocument<EventTemplate>;

/**
 * A reusable set of event defaults (spec §4.5).
 *
 * Every field except `name`/`ownerId` is optional: a template supplies only
 * what the organizer wants pre-filled, and `POST /events` fills omitted
 * request fields from it — never overriding what the caller sent.
 *
 * Deliberately NOT linked to the events it creates. `Event.templateId` records
 * which template was used, but editing a template afterwards must not
 * retroactively change events already scheduled from it.
 */
@Schema({ timestamps: true })
export class EventTemplate {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  ownerId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Group', default: null })
  groupId: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  title: string | null;

  @Prop({ type: String, default: null })
  description: string | null;

  @Prop({ type: Types.ObjectId, ref: 'Location', default: null })
  locationId: Types.ObjectId | null;

  @Prop({ type: Number, default: null })
  maxPlayers: number | null;

  @Prop({ type: Number, default: null })
  teamCount: number | null;

  @Prop({ type: String, default: null })
  sportType: string | null;

  @Prop({ type: String, default: null })
  skillLevel: string | null;

  @Prop({ type: Number, default: null })
  price: number | null;

  @Prop({ type: Boolean, default: null })
  isPublic: boolean | null;
}

export const EventTemplateSchema = SchemaFactory.createForClass(EventTemplate);

// The only listing this collection serves: "my templates, newest first".
EventTemplateSchema.index({ ownerId: 1, createdAt: -1 });
