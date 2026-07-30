import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { EventsService } from './events.service';
import { Event } from './schemas/event.schema';
import { EventPlayer } from './schemas/event-player.schema';
import { GroupMember } from '../groups/schemas/group-member.schema';
import { LocationsService } from '../locations/locations.service';

const OWNED_LOCATION = '507f1f77bcf86cd799439011';
const USER_ID = '507f191e810c19729de860ea';

describe('EventsService — location handling on create', () => {
  let service: EventsService;
  const eventModel: any = { create: jest.fn() };
  const playerModel: any = {};
  const memberModel: any = {};
  const locations = { assertOwnedBy: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    eventModel.create = jest.fn().mockResolvedValue({ _id: 'e1' });
    const m = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: getModelToken(Event.name), useValue: eventModel },
        { provide: getModelToken(EventPlayer.name), useValue: playerModel },
        { provide: getModelToken(GroupMember.name), useValue: memberModel },
        { provide: LocationsService, useValue: locations },
      ],
    }).compile();
    service = m.get(EventsService);
  });

  const baseDto = {
    title: 'Sunday game',
    date: '2026-08-01T10:00:00.000Z',
  } as any;

  it('verifies ownership and stores locationId as an ObjectId', async () => {
    await service.create(USER_ID, { ...baseDto, locationId: OWNED_LOCATION });

    // must check the caller owns the location before writing
    expect(locations.assertOwnedBy).toHaveBeenCalledWith(
      OWNED_LOCATION,
      USER_ID,
    );

    const arg = eventModel.create.mock.calls[0][0];
    // stored as an ObjectId, not the raw string
    expect(typeof arg.locationId).toBe('object');
    expect(arg.locationId.toString()).toBe(OWNED_LOCATION);
  });

  it('stores null when no locationId is supplied and skips the ownership check', async () => {
    await service.create(USER_ID, { ...baseDto });

    expect(locations.assertOwnedBy).not.toHaveBeenCalled();
    expect(eventModel.create.mock.calls[0][0].locationId).toBeNull();
  });

  it('does not leak the raw locationId string onto the model payload', async () => {
    await service.create(USER_ID, { ...baseDto, locationId: OWNED_LOCATION });

    const arg = eventModel.create.mock.calls[0][0];
    // the spread must not have carried a string through — guards against the
    // silent-drop/mistyped-field trap, which Mongoose's loose create() typing
    // would not catch at compile time.
    expect(typeof arg.locationId).not.toBe('string');
  });

  it('propagates a rejection from the ownership check without writing', async () => {
    locations.assertOwnedBy.mockRejectedValueOnce(new Error('not yours'));

    await expect(
      service.create(USER_ID, { ...baseDto, locationId: OWNED_LOCATION }),
    ).rejects.toThrow('not yours');
    expect(eventModel.create).not.toHaveBeenCalled();
  });
});
