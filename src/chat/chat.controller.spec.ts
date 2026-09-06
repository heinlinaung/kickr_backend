// src/chat/chat.controller.spec.ts
import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { GroupsService } from '../groups/groups.service';

const GROUP = '6a6b2366f78b66d63a911a9e';
const USER = '507f191e810c19729de860e1';

describe('ChatController — POST /groups/:id/messages', () => {
  let controller: ChatController;
  const chatService: any = {};
  const groupsService: any = {};
  const gateway: any = {};

  const stored = {
    _id: 'm1',
    groupId: GROUP,
    senderId: { _id: USER, name: 'Hein', profileImage: null },
    text: 'See everyone at 7pm',
    createdAt: new Date('2026-09-06T10:00:00Z'),
  };

  const caller = { _id: USER };
  const send = (text = 'See everyone at 7pm') =>
    controller.send(GROUP, caller, { text } as any);

  beforeEach(async () => {
    jest.clearAllMocks();
    groupsService.getMemberRole = jest.fn().mockResolvedValue('member');
    chatService.createMessage = jest.fn().mockResolvedValue(stored);
    chatService.getHistory = jest.fn().mockResolvedValue([]);
    gateway.broadcastMessage = jest.fn();

    const m = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        { provide: ChatService, useValue: chatService },
        { provide: GroupsService, useValue: groupsService },
        { provide: ChatGateway, useValue: gateway },
      ],
    }).compile();
    controller = m.get(ChatController);
  });

  describe('access control', () => {
    it('stores the message for a member', async () => {
      const res = await send();

      expect(chatService.createMessage).toHaveBeenCalledWith(
        GROUP,
        USER,
        'See everyone at 7pm',
      );
      expect(res).toBe(stored);
    });

    it('refuses a non-member with 403', async () => {
      groupsService.getMemberRole.mockResolvedValue(null);

      await expect(send()).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('writes NOTHING when the caller is refused', async () => {
      // The check must gate the write, not merely precede it.
      groupsService.getMemberRole.mockResolvedValue(null);

      await expect(send()).rejects.toThrow();

      expect(chatService.createMessage).not.toHaveBeenCalled();
      expect(gateway.broadcastMessage).not.toHaveBeenCalled();
    });

    it('checks membership of the group in the URL, as the caller', async () => {
      // A caller must not be able to post into a group by naming a different
      // one anywhere else in the request.
      await send();

      expect(groupsService.getMemberRole).toHaveBeenCalledWith(GROUP, USER);
    });

    it('uses the same gate as reading history', async () => {
      // getMemberRole returns null for a PENDING request too, so an unapproved
      // requester can neither read nor post. Pinned because a divergence here
      // would let someone post into a group they cannot see.
      groupsService.getMemberRole.mockResolvedValue(null);

      await expect(
        controller.getHistory(GROUP, undefined, caller),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(send()).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('broadcast', () => {
    it('emits to the group room after storing', async () => {
      await send();

      expect(gateway.broadcastMessage).toHaveBeenCalledWith(GROUP, stored);
    });

    it('broadcasts the SAME object it returns', async () => {
      // A client rendering the HTTP response and a client receiving the socket
      // event must show the same message, sender included.
      const res = await send();

      expect(gateway.broadcastMessage.mock.calls[0][1]).toBe(res);
    });

    it('stores before broadcasting, never the reverse', async () => {
      // Emitting first would show other members a message that might then fail
      // to save.
      const order: string[] = [];
      chatService.createMessage.mockImplementation(async () => {
        order.push('store');
        return stored;
      });
      gateway.broadcastMessage.mockImplementation(() => order.push('emit'));

      await send();

      expect(order).toEqual(['store', 'emit']);
    });

    it('does not broadcast when the write fails', async () => {
      chatService.createMessage.mockRejectedValue(new Error('mongo down'));

      await expect(send()).rejects.toThrow('mongo down');

      expect(gateway.broadcastMessage).not.toHaveBeenCalled();
    });
  });
});
