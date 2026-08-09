// src/admin/schemas/test-run.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TestRunDocument = HydratedDocument<TestRun>;

/**
 * A ledger of everything one admin test run created, so it can be torn down
 * later (spec: "may be we need testId(uuid) to identify the created data").
 *
 * Seeded data is deliberately left in place for manual verification, which
 * means something has to remember what to delete. Ids are recorded as they are
 * created rather than re-derived at cleanup time: a run that fails halfway
 * still leaves an accurate record of what actually landed.
 *
 * `userEmails` is stored alongside `userIds` because Cognito identities are
 * keyed by email, not by Mongo id — cleanup has to reach both stores.
 */
@Schema({ timestamps: true })
export class TestRun {
  /** UUID handed back to the caller; the handle for cleanup. */
  @Prop({ required: true, unique: true, index: true })
  testId: string;

  @Prop({ required: true, enum: ['full', 'partial'] })
  mode: string;

  @Prop({ required: true })
  emailPrefix: string;

  @Prop({ required: true })
  emailPostfix: string;

  @Prop({ type: [Types.ObjectId], default: [] })
  userIds: Types.ObjectId[];

  /** Needed to delete the matching Cognito identities. */
  @Prop({ type: [String], default: [] })
  userEmails: string[];

  @Prop({ type: [Types.ObjectId], default: [] })
  groupIds: Types.ObjectId[];

  @Prop({ type: [Types.ObjectId], default: [] })
  locationIds: Types.ObjectId[];

  @Prop({ type: [Types.ObjectId], default: [] })
  eventIds: Types.ObjectId[];

  @Prop({ default: 'created', enum: ['created', 'cleaned'] })
  status: string;

  /** Whether real Cognito identities were made, so cleanup knows to remove them. */
  @Prop({ default: true })
  cognitoUsers: boolean;

  @Prop({ type: Date, default: null })
  cleanedAt: Date | null;
}

export const TestRunSchema = SchemaFactory.createForClass(TestRun);
