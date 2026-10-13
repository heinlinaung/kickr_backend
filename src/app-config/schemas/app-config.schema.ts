import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AppConfigDocument = HydratedDocument<AppConfig>;

/** The "a newer version exists" prompt for one platform. */
@Schema({ _id: false })
export class AppUpdatePlatform {
  @Prop({ required: true })
  latestVersion: string;

  /** Builds below this are too old to keep running. */
  @Prop({ required: true })
  minimumVersion: string;

  @Prop({ required: true })
  upgradeTitle: string;

  @Prop({ required: true })
  upgradeDescription: string;

  @Prop({ default: false })
  forceUpdate: boolean;
}
const AppUpdatePlatformSchema = SchemaFactory.createForClass(AppUpdatePlatform);

/** The "major update" announcement for one platform. */
@Schema({ _id: false })
export class MajorUpdatePlatform {
  @Prop({ default: false })
  enabled: boolean;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true })
  version: string;
}
const MajorUpdatePlatformSchema =
  SchemaFactory.createForClass(MajorUpdatePlatform);

@Schema({ _id: false })
export class AppUpdate {
  @Prop({ type: AppUpdatePlatformSchema, required: true })
  ios: AppUpdatePlatform;

  @Prop({ type: AppUpdatePlatformSchema, required: true })
  android: AppUpdatePlatform;
}
const AppUpdateSchema = SchemaFactory.createForClass(AppUpdate);

@Schema({ _id: false })
export class MajorUpdate {
  @Prop({ type: MajorUpdatePlatformSchema, required: true })
  ios: MajorUpdatePlatform;

  @Prop({ type: MajorUpdatePlatformSchema, required: true })
  android: MajorUpdatePlatform;
}
const MajorUpdateSchema = SchemaFactory.createForClass(MajorUpdate);

/**
 * Client app configuration — what the mobile apps read at startup to decide
 * whether to prompt for (or force) an update.
 *
 * Append-only: every write inserts a new document with the next `revision`,
 * and the highest revision is the live config. Older documents are never
 * changed or deleted, so they are the history of what was served when.
 */
@Schema({ timestamps: true, collection: 'appconfigs' })
export class AppConfig {
  /**
   * 1, 2, 3… in write order. Unique so two concurrent writes cannot both
   * claim the same revision — the loser gets a duplicate-key error instead
   * of silently creating a second "latest".
   */
  @Prop({ required: true, unique: true })
  revision: number;

  @Prop({ type: AppUpdateSchema, required: true })
  appUpdate: AppUpdate;

  @Prop({ type: MajorUpdateSchema, required: true })
  majorUpdate: MajorUpdate;

  /** The superadmin who saved this revision. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  updatedBy: Types.ObjectId | null;
}

export const AppConfigSchema = SchemaFactory.createForClass(AppConfig);
