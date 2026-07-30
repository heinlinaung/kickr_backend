// src/events/schemas/event.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type EventDocument = HydratedDocument<Event>;

@Schema({ timestamps: true })
export class Event {
  @Prop({ required: true })
  title: string;

  @Prop()
  description: string;

  @Prop({ required: true })
  date: Date;

  @Prop({ type: Types.ObjectId, ref: 'Group', default: null })
  groupId: Types.ObjectId | null;

  @Prop({ default: false })
  isPublic: boolean;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Location', default: null })
  locationId: Types.ObjectId | null;

  @Prop({ default: 12 })
  maxPlayers: number;

  @Prop({ default: 0 })
  joinedCount: number;

  @Prop({ default: 'football', enum: ['football', 'futsal'] })
  sportType: string;

  @Prop({ default: 'beginner', enum: ['beginner', 'intermediate', 'advanced'] })
  skillLevel: string;

  @Prop({ default: 0 })
  price: number;

  @Prop({ default: 'open', enum: ['open', 'full', 'done'] })
  status: string;
}

export const EventSchema = SchemaFactory.createForClass(Event);
EventSchema.index({ groupId: 1, date: 1 });
EventSchema.index({ isPublic: 1, date: 1 });
EventSchema.index({ createdBy: 1, date: -1 });
