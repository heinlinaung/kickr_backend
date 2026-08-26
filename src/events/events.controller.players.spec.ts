// src/events/events.controller.players.spec.ts
//
// Scoped to the roster routes. EventsController is large, so mocking it
// wholesale would couple this spec to every unrelated route.
import { Test } from '@nestjs/testing';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

describe('EventsController — roster', () => {
  let controller: EventsController;

  const svc = {
    listPlayers: jest.fn().mockResolvedValue([]),
    leave: jest.fn().mockResolvedValue({ message: 'ok' }),
    removePlayer: jest.fn().mockResolvedValue({ message: 'ok' }),
  };

  const user = { _id: 'organizer-1' } as any;

  beforeEach(async () => {
    jest.clearAllMocks();
    const m = await Test.createTestingModule({
      controllers: [EventsController],
      providers: [{ provide: EventsService, useValue: svc }],
    }).compile();
    controller = m.get(EventsController);
  });

  describe('removePlayer', () => {
    it('passes the event, the CALLER, then the TARGET — in that order', async () => {
      // The whole risk in this route is the two ids. Swapping them would
      // remove the organizer instead of the player they picked.
      await controller.removePlayer('e1', 'target-9', user);

      expect(svc.removePlayer).toHaveBeenCalledWith(
        'e1',
        'organizer-1',
        'target-9',
      );
    });

    it('takes the organizer from the token, never from the path', async () => {
      await controller.removePlayer('e1', 'target-9', user);

      const [, requesterId, targetUserId] = svc.removePlayer.mock.calls[0];
      expect(requesterId).toBe('organizer-1');
      expect(targetUserId).toBe('target-9');
      // A path-supplied id must not be able to stand in for the caller.
      expect(requesterId).not.toBe('target-9');
    });
  });

  describe('self-leave stays separate', () => {
    it('DELETE /events/:id/join uses the caller as the subject', async () => {
      // Distinct from removePlayer: here caller and subject are the same
      // person, and no organizer check applies.
      await controller.leave('e1', user);
      expect(svc.leave).toHaveBeenCalledWith('e1', 'organizer-1');
      expect(svc.removePlayer).not.toHaveBeenCalled();
    });
  });

  describe('route shape', () => {
    it('declares the two-segment player route, not a bare :id', () => {
      const src: string = require('fs').readFileSync(
        __dirname + '/events.controller.ts',
        'utf8',
      );
      // A one-segment @Delete(':id') must not be what handles this.
      expect(src).toContain("@Delete(':id/players/:userId')");
      // Self-leave must still exist and be a different path.
      expect(src).toContain("@Delete(':id/join')");
    });
  });
});
