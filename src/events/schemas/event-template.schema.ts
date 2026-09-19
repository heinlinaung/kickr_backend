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

  // `teamCount` was removed from templates on 2026-09-19: it is no longer
  // part of the template request or the create-time fill, so an event made
  // from a template gets the event schema's own default. Old documents may
  // still carry the field; nothing reads it.

  /**
   * Stored so the template body mirrors the event-create body, but NEVER
   * filled into a created event: `date` is required on POST /events, so the
   * caller always supplies the real one and the fill (which only covers
   * omitted fields) can never apply this.
   */
  @Prop({ type: Date, default: null })
  date: Date | null;

  @Prop({ type: String, default: null })
  sportType: string | null;

  /** Format of the sport (e.g. football: futsal/stadium), like Event.subType. */
  @Prop({ type: String, default: null })
  subType: string | null;

  @Prop({ type: String, default: null })
  skillLevel: string | null;

  @Prop({ type: Number, default: null })
  price: number | null;

  @Prop({ type: Number, default: null })
  additionalPrice: number | null;

  @Prop({ type: Boolean, default: null })
  takeAdditionalPrice: boolean | null;

  @Prop({ type: Boolean, default: null })
  isAllowExtraPlayer: boolean | null;

  @Prop({ type: Number, default: null })
  duration: number | null;

  @Prop({ type: Number, default: null })
  registrationClosingDuration: number | null;

  @Prop({ type: Boolean, default: null })
  isPublic: boolean | null;
}

export const EventTemplateSchema = SchemaFactory.createForClass(EventTemplate);

// The only listing this collection serves: "my templates, newest first".
EventTemplateSchema.index({ ownerId: 1, createdAt: -1 });
