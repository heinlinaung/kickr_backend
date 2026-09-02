// src/notifications/notifications.service.spec.ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { PushService } from './push.service';
import { Notification } from './schemas/notification.schema';
import { User } from '../users/schemas/user.schema';

const U1 = '507f191e810c19729de860e1';
const U2 = '507f191e810c19729de860e2';

describe('NotificationsService — fan-out', () => {
  let service: NotificationsService;
  const notifModel: any = {};
  const userModel: any = {};
  const push: any = {};
  const gateway: any = {};

  const payload = {
    title: 'New event',
    body: 'Friday night five',
    type: 'event' as const,
    refId: '507f1f77bcf86cd799439011',
  };

  const rows = (ids: string[]) =>
    ids.map((id) => ({
      _id: new Types.ObjectId(),
      userId: new Types.ObjectId(id),
      toJSON() {
        return { userId: String(this.userId) };
      },
    }));

  beforeEach(async () => {
    jest.clearAllMocks();
    notifModel.insertMany = jest
      .fn()
      .mockImplementation((docs: any[]) =>
        Promise.resolve(rows(docs.map((d: any) => String(d.userId)))),
      );
    userModel.find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });
    userModel.updateMany = jest.fn().mockResolvedValue({ modifiedCount: 0 });
    userModel.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    push.isEnabled = true;
    push.sendToTokens = jest
      .fn()
      .mockResolvedValue({ sent: 0, invalidTokens: [] });
    gateway.emitToUser = jest.fn();

    const m = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getModelToken(Notification.name), useValue: notifModel },
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: PushService, useValue: push },
        { provide: NotificationsGateway, useValue: gateway },
      ],
    }).compile();
    service = m.get(NotificationsService);
  });

  it('persists a row per recipient, then delivers', async () => {
    // Persist FIRST: the stored row is the source of truth for the in-app
    // list, so it must survive a socket or FCM failure.
    await service.notifyUsers([U1, U2], payload);

    expect(notifModel.insertMany).toHaveBeenCalled();
    expect(notifModel.insertMany.mock.calls[0][0]).toHaveLength(2);
    expect(gateway.emitToUser).toHaveBeenCalledTimes(2);
  });

  it('de-duplicates recipients', async () => {
    // Callers compute audiences from roster and membership queries that can
    // overlap — an organizer who also joined must not be told twice.
    await service.notifyUsers([U1, U1, U2], payload);

    expect(notifModel.insertMany.mock.calls[0][0]).toHaveLength(2);
  });

  it('is a no-op for an empty audience', async () => {
    const res = await service.notifyUsers([], payload);

    expect(res).toEqual({ notified: 0, pushed: 0 });
    expect(notifModel.insertMany).not.toHaveBeenCalled();
  });

  it('does NOT throw when the socket emit fails', async () => {
    gateway.emitToUser.mockImplementation(() => {
      throw new Error('socket down');
    });

    await expect(service.notifyUsers([U1], payload)).resolves.toBeDefined();
  });

  it('does NOT throw when push fails', async () => {
    // The triggering request must not 500 because FCM had a bad minute.
    push.sendToTokens.mockRejectedValue(new Error('fcm down'));

    await expect(service.notifyUsers([U1], payload)).resolves.toBeDefined();
  });

  it('still returns cleanly when persistence fails', async () => {
    notifModel.insertMany.mockRejectedValue(new Error('mongo down'));

    await expect(service.notifyUsers([U1], payload)).resolves.toEqual({
      notified: 0,
      pushed: 0,
    });
  });

  describe('push', () => {
    const withDevices = () =>
      userModel.find.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest
          .fn()
          .mockResolvedValue([
            { devices: [{ fcmToken: 'tok-a' }, { fcmToken: 'tok-b' }] },
            { devices: [{ fcmToken: 'tok-c' }] },
          ]),
      });

    it('sends every device of every user in ONE multicast', async () => {
      // FCM rate-limits per call; a group of 30 should not be 30 round trips.
      withDevices();

      await service.notifyUsers([U1, U2], payload);

      expect(push.sendToTokens).toHaveBeenCalledTimes(1);
      expect(push.sendToTokens.mock.calls[0][0]).toEqual([
        'tok-a',
        'tok-b',
        'tok-c',
      ]);
    });

    it('sends data values as strings, which FCM requires', async () => {
      withDevices();

      await service.notifyUsers([U1], payload);

      const sentPayload = push.sendToTokens.mock.calls[0][1];
      for (const value of Object.values(sentPayload.data)) {
        expect(typeof value).toBe('string');
      }
    });

    it('prunes tokens FCM reports as permanently invalid', async () => {
      withDevices();
      push.sendToTokens.mockResolvedValue({
        sent: 2,
        invalidTokens: ['tok-b'],
      });

      await service.notifyUsers([U1], payload);

      const [filter, update] = userModel.updateMany.mock.calls[0];
      expect(filter['devices.fcmToken'].$in).toEqual(['tok-b']);
      expect(update.$pull.devices.fcmToken.$in).toEqual(['tok-b']);
    });

    it('prunes nothing when every token was accepted', async () => {
      withDevices();

      await service.notifyUsers([U1], payload);

      expect(userModel.updateMany).not.toHaveBeenCalled();
    });

    it('skips FCM entirely when it is not configured', async () => {
      push.isEnabled = false;
      withDevices();

      await service.notifyUsers([U1], payload);

      // Local dev and CI have no Firebase project; the rest must still work.
      expect(push.sendToTokens).not.toHaveBeenCalled();
      expect(notifModel.insertMany).toHaveBeenCalled();
    });
  });

  describe('device registration', () => {
    it('detaches the token from any other account first', async () => {
      // A handed-over or shared device must not keep receiving the previous
      // user's notifications.
      await service.registerDevice(U1, 'tok-a', 'android');

      expect(userModel.updateMany).toHaveBeenCalledWith(
        { 'devices.fcmToken': 'tok-a' },
        { $pull: { devices: { fcmToken: 'tok-a' } } },
      );
      const [, update] = userModel.updateOne.mock.calls[0];
      expect(update.$push.devices.fcmToken).toBe('tok-a');
    });

    it('removes only the named device on unregister', async () => {
      await service.unregisterDevice(U1, 'tok-a');

      const [filter, update] = userModel.updateOne.mock.calls[0];
      expect(String(filter._id)).toBe(U1);
      expect(update.$pull.devices).toEqual({ fcmToken: 'tok-a' });
    });
  });
});
