// src/events/schemas/event-player.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type EventPlayerDocument = HydratedDocument<EventPlayer>;

@Schema({ timestamps: true })
export class EventPlayer {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Event' })
  eventId: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId: Types.ObjectId;

  @Prop()
  joinedAt: Date;

  @Prop({ default: null })
  team: string | null;

  @Prop()
  position: string;

  @Prop({ default: 'joined', enum: ['joined', 'cancelled'] })
  status: string;

  @Prop()
  checkInTime: Date;
}

export const EventPlayerSchema = SchemaFactory.createForClass(EventPlayer);
EventPlayerSchema.index({ eventId: 1, userId: 1 }, { unique: true });
