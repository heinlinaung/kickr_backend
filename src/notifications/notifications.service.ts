import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Notification,
  NotificationDocument,
} from './schemas/notification.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { PushService } from './push.service';
import { NotificationsGateway } from './notifications.gateway';

/** One notification, addressed to many users. */
export interface NotifyPayload {
  title: string;
  body: string;
  type: 'event' | 'group';
  refId: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name)
    private notifModel: Model<NotificationDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly push: PushService,
    private readonly gateway: NotificationsGateway,
  ) {}

  /**
   * Delivers one notification to many users over all three channels.
   *
   * The order is deliberate: **persist first**, then deliver. The stored row is
   * the source of truth for the in-app list, so it must survive a socket or FCM
   * failure — a user who was offline for both still sees the notification next
   * time they open the app.
   *
   * Nothing here throws. Every caller is a side effect of some other action
   * (an event being created, a status advancing), and none of those should fail
   * because a notification could not be delivered.
   *
   * De-duplicated on `userId`, because the callers compute their audiences from
   * roster and membership queries that can legitimately overlap — an organizer
   * who also joined would otherwise be notified twice.
   */
  async notifyUsers(userIds: string[], payload: NotifyPayload) {
    const unique = [...new Set(userIds.map(String))].filter(Boolean);
    if (!unique.length) return { notified: 0, pushed: 0 };

    let rows: NotificationDocument[] = [];
    try {
      rows = await this.notifModel.insertMany(
        unique.map((userId) => ({
          userId: new Types.ObjectId(userId),
          ...payload,
        })),
      );
    } catch (err) {
      // Persistence is the one part worth shouting about: without a row the
      // notification is lost entirely rather than merely undelivered.
      this.logger.error(`Failed to persist notifications: ${err}`);
      return { notified: 0, pushed: 0 };
    }

    // Live delivery to anyone with the app open.
    //
    // Wrapped PER RECIPIENT, not around the loop: emitToUser is synchronous, so
    // one throw would otherwise abort the remaining emits, skip the push branch
    // below, and reject into the caller — failing the very request (event
    // create, status change) this notification is only a side effect of. One
    // unreachable socket must not silence FCM for everyone else.
    for (const row of rows) {
      try {
        this.gateway.emitToUser(String(row.userId), row.toJSON?.() ?? row);
      } catch (err) {
        this.logger.warn(
          `Socket emit failed for ${String(row.userId)}: ${err}`,
        );
      }
    }

    const pushed = await this.pushToUsers(unique, payload);
    return { notified: rows.length, pushed };
  }

  /**
   * Fans a payload out to every registered device of every listed user.
   *
   * One multicast for all tokens rather than one send per user: FCM charges and
   * rate-limits per call, and a group of 30 would otherwise be 30 round trips.
   *
   * Tokens FCM rejects as permanently invalid are pruned here. That cleanup is
   * the reason this bothers to map tokens back to users at all — without it the
   * `devices` array only grows, and every later send wastes calls on tokens
   * belonging to uninstalled apps.
   */
  private async pushToUsers(
    userIds: string[],
    payload: NotifyPayload,
  ): Promise<number> {
    if (!this.push.isEnabled) return 0;

    try {
      const users = await this.userModel
        .find({
          _id: { $in: userIds.map((id) => new Types.ObjectId(id)) },
          'devices.0': { $exists: true },
        })
        .select('devices')
        .lean();

      const tokens = users.flatMap((user) =>
        (user.devices ?? []).map((device) => device.fcmToken),
      );
      if (!tokens.length) return 0;

      const { sent, invalidTokens } = await this.push.sendToTokens(tokens, {
        title: payload.title,
        body: payload.body,
        // FCM data values must be strings — a number here is rejected at send
        // time, which is easy to miss since the notification half still works.
        data: { type: payload.type, refId: String(payload.refId) },
      });

      if (invalidTokens.length) {
        await this.userModel.updateMany(
          { 'devices.fcmToken': { $in: invalidTokens } },
          { $pull: { devices: { fcmToken: { $in: invalidTokens } } } },
        );
      }

      return sent;
    } catch (err) {
      this.logger.error(`Push fan-out failed: ${err}`);
      return 0;
    }
  }

  /** Registers or refreshes one device's push token for a user. */
  async registerDevice(userId: string, fcmToken: string, platform: string) {
    // Pulled then pushed rather than upserted in place: the same token can move
    // between accounts when a device is handed over or a user switches logins,
    // and leaving it on the old account would deliver that user's
    // notifications to somebody else's phone.
    await this.userModel.updateMany(
      { 'devices.fcmToken': fcmToken },
      { $pull: { devices: { fcmToken } } },
    );
    await this.userModel.updateOne(
      { _id: new Types.ObjectId(userId) },
      { $push: { devices: { fcmToken, platform, updatedAt: new Date() } } },
    );
    return { message: 'Device registered' };
  }

  /** Deregisters one device — call on logout, or push follows the user out. */
  async unregisterDevice(userId: string, fcmToken: string) {
    await this.userModel.updateOne(
      { _id: new Types.ObjectId(userId) },
      { $pull: { devices: { fcmToken } } },
    );
    return { message: 'Device unregistered' };
  }

  async create(data: {
    userId: string;
    title: string;
    body: string;
    type: 'event' | 'group';
    refId: string;
  }) {
    return this.notifModel.create({
      ...data,
      userId: new Types.ObjectId(data.userId),
    });
  }

  async findForUser(userId: string) {
    return this.notifModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ isRead: 1, createdAt: -1 })
      .lean();
  }

  async markRead(notifId: string, userId: string) {
    return this.notifModel.findOneAndUpdate(
      { _id: notifId, userId: new Types.ObjectId(userId) },
      { $set: { isRead: true } },
      { new: true },
    );
  }

  async markAllRead(userId: string) {
    await this.notifModel.updateMany(
      { userId: new Types.ObjectId(userId), isRead: false },
      { $set: { isRead: true } },
    );
    return { message: 'All notifications marked as read' };
  }
}
