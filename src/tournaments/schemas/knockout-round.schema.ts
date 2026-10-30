// src/tournaments/schemas/knockout-round.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type KnockoutRoundDocument = HydratedDocument<KnockoutRound>;

@Schema({ timestamps: true })
export class KnockoutRound {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Tournament' })
  tournamentId: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'TournamentPhase' })
  phaseId: Types.ObjectId;

  /** Quarter-final, Semi-final, Final… or Third place. */
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  order: number;

  /** Teams entering the round (bracket positions, byes included). */
  @Prop({ required: true })
  teams: number;

  @Prop({ default: false })
  isThirdPlace: boolean;
}

export const KnockoutRoundSchema = SchemaFactory.createForClass(KnockoutRound);
KnockoutRoundSchema.index({ phaseId: 1, order: 1 });
