import { Test } from '@nestjs/testing';
import { EventsService } from './events.service';
import { eventsProviders } from './events.test-providers';

const OWNED_LOCATION = '507f1f77bcf86cd799439011';
const USER_ID = '507f191e810c19729de860ea';

describe('EventsService — location handling on create', () => {
  let service: EventsService;
  const eventModel: any = { create: jest.fn() };
  const playerModel: any = {};
  const memberModel: any = {};
  const groupModel: any = {};
  // findById reports likedByMe; create() may resolve a template.
  const likeModel: any = { exists: jest.fn().mockResolvedValue(null) };
  const templateModel: any = { findById: jest.fn() };
  // §4.6: event location attach moved from assertOwnedBy to assertCanEdit so
  // a group's owner/admin/captain can attach the group's own ground.
  const locations = { assertOwnedBy: jest.fn(), assertCanEdit: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    eventModel.create = jest.fn().mockResolvedValue({ _id: 'e1' });
    const m = await Test.createTestingModule({
      providers: [
        EventsService,
        ...eventsProviders({
          eventModel,
          playerModel,
          memberModel,
          groupModel,
          likeModel,
          templateModel,
          locations,
        }),
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
    expect(locations.assertCanEdit).toHaveBeenCalledWith(
      OWNED_LOCATION,
      USER_ID,
    );
    // the stricter creator-only check must NOT be used — it rejected group
    // admins attaching their own group's ground (§4.6)
    expect(locations.assertOwnedBy).not.toHaveBeenCalled();

    const arg = eventModel.create.mock.calls[0][0];
    // stored as an ObjectId, not the raw string
    expect(typeof arg.locationId).toBe('object');
    expect(arg.locationId.toString()).toBe(OWNED_LOCATION);
  });

  it('stores null when no locationId is supplied and skips the ownership check', async () => {
    await service.create(USER_ID, { ...baseDto });

    expect(locations.assertCanEdit).not.toHaveBeenCalled();
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

  it('propagates a rejection from the permission check without writing', async () => {
    locations.assertCanEdit.mockRejectedValueOnce(new Error('not yours'));

    await expect(
      service.create(USER_ID, { ...baseDto, locationId: OWNED_LOCATION }),
    ).rejects.toThrow('not yours');
    expect(eventModel.create).not.toHaveBeenCalled();
  });

  it('lets a group admin attach a location they did not personally create', async () => {
    // The regression §4.6 fixes: assertCanEdit permits the owning group's
    // owner/admin/captain, so this resolves where assertOwnedBy would throw.
    locations.assertCanEdit.mockResolvedValueOnce({ _id: OWNED_LOCATION });

    await expect(
      service.create(USER_ID, { ...baseDto, locationId: OWNED_LOCATION }),
    ).resolves.toBeDefined();
    expect(eventModel.create).toHaveBeenCalled();
  });
});

describe('EventsService — group rules on detail & ?region= filter', () => {
  let service: EventsService;
  const eventModel: any = {};
  const playerModel: any = {};
  const memberModel: any = {};
  const groupModel: any = {};
  // findById reports likedByMe/joinedByMe; create() may resolve a template.
  const likeModel: any = { exists: jest.fn().mockResolvedValue(null) };
  const templateModel: any = { findById: jest.fn() };
  // §4.6: event location attach moved from assertOwnedBy to assertCanEdit so
  // a group's owner/admin/captain can attach the group's own ground.
  const locations = { assertOwnedBy: jest.fn(), assertCanEdit: jest.fn() };

  const GROUP_ID = '507f1f77bcf86cd799439099';
  const CALLER = '507f191e810c19729de860ea';

  /** chainable mongoose query stub */
  const q = (result: any) => ({
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    Object.assign(eventModel, { find: jest.fn(), findById: jest.fn() });
    Object.assign(groupModel, { find: jest.fn(), findById: jest.fn() });
    playerModel.exists = jest.fn().mockResolvedValue(null);

    const m = await Test.createTestingModule({
      providers: [
        EventsService,
        ...eventsProviders({
          eventModel,
          playerModel,
          memberModel,
          groupModel,
          likeModel,
          templateModel,
          locations,
        }),
      ],
    }).compile();
    service = m.get(EventsService);
  });

  describe('findById → joinedByMe', () => {
    const anEvent = () =>
      eventModel.findById.mockReturnValue(q({ _id: 'e1', groupId: null }));

    it('is true when the caller is on the roster', async () => {
      anEvent();
      playerModel.exists.mockResolvedValue({ _id: 'p1' });

      const res: any = await service.findById('e1', CALLER);

      expect(res.joinedByMe).toBe(true);
    });

    it('is false when the caller has not joined', async () => {
      anEvent();
      playerModel.exists.mockResolvedValue(null);

      const res: any = await service.findById('e1', CALLER);

      expect(res.joinedByMe).toBe(false);
    });

    it("only counts a 'joined' row, not a cancelled one", async () => {
      // Leaving sets status 'cancelled' and keeps the row for reactivation, so
      // its mere presence is not membership.
      anEvent();
      await service.findById('e1', CALLER);

      expect(playerModel.exists).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'joined' }),
      );
    });

    it('is false — never undefined — when there is no caller', async () => {
      anEvent();

      const res: any = await service.findById('e1');

      expect(res.joinedByMe).toBe(false);
      expect(playerModel.exists).not.toHaveBeenCalled();
    });

    it('is independent of the group role', async () => {
      // A group owner who never joined must still read as not joined — the
      // gap that prompted this field.
      eventModel.findById.mockReturnValue(q({ _id: 'e1', groupId: GROUP_ID }));
      groupModel.findById.mockReturnValue(q({ rules: '' }));
      memberModel.findOne = jest
        .fn()
        .mockReturnValue(q({ role: 'owner', status: 'approved' }));
      playerModel.exists.mockResolvedValue(null);

      const res: any = await service.findById('e1', CALLER);

      expect(res.userRole).toBe('owner');
      expect(res.joinedByMe).toBe(false);
    });
  });

  describe('findById → groupRules', () => {
    it("attaches the parent group's rules as text", async () => {
      const rules = 'No smoking\nArrive 15 min early\n(or tell the captain)';
      eventModel.findById.mockReturnValue(q({ _id: 'e1', groupId: GROUP_ID }));
      groupModel.findById.mockReturnValue(q({ rules }));

      const res: any = await service.findById('e1');

      expect(res.groupRules).toBe(rules);
      // Newlines must survive to the client — rules are now one text block.
      expect(res.groupRules).toContain('\n');
    });

    it("returns '' for an event with no group, never null", async () => {
      eventModel.findById.mockReturnValue(q({ _id: 'e1', groupId: null }));

      const res: any = await service.findById('e1');

      expect(res.groupRules).toBe('');
      expect(groupModel.findById).not.toHaveBeenCalled();
    });

    it("returns '' when the group has no rules set", async () => {
      eventModel.findById.mockReturnValue(q({ _id: 'e1', groupId: GROUP_ID }));
      groupModel.findById.mockReturnValue(q({}));

      const res: any = await service.findById('e1');

      expect(res.groupRules).toBe('');
    });
  });

  describe('list → ?region=', () => {
    it('does not filter by group when region is absent', async () => {
      eventModel.find.mockReturnValue(q([]));

      await service.list('u1');

      expect(eventModel.find).toHaveBeenCalledWith({ isPublic: true });
      expect(groupModel.find).not.toHaveBeenCalled();
    });

    it('matches a region against country OR city, case-insensitively', async () => {
      groupModel.find.mockReturnValue(q([{ _id: GROUP_ID }]));
      eventModel.find.mockReturnValue(q([{ _id: 'e1' }]));

      await service.list('u1', { region: 'yangon' });

      const groupFilter = groupModel.find.mock.calls[0][0];
      expect(groupFilter.$or).toHaveLength(2);
      const [byCountry, byCity] = groupFilter.$or;
      expect(byCountry.country.flags).toContain('i');
      expect(byCountry.country.test('Yangon')).toBe(true);
      expect(byCity.city.test('Yangon')).toBe(true);

      const eventFilter = eventModel.find.mock.calls[0][0];
      expect(eventFilter.groupId).toEqual({ $in: [GROUP_ID] });
      expect(eventFilter.isPublic).toBe(true);
    });

    it('returns [] without querying events when no group matches', async () => {
      groupModel.find.mockReturnValue(q([]));

      const res = await service.list('u1', { region: 'Atlantis' });

      expect(res).toEqual([]);
      expect(eventModel.find).not.toHaveBeenCalled();
    });

    it('ignores a whitespace-only region', async () => {
      eventModel.find.mockReturnValue(q([]));

      await service.list('u1', { region: '   ' });

      expect(groupModel.find).not.toHaveBeenCalled();
      expect(eventModel.find).toHaveBeenCalledWith({ isPublic: true });
    });

    it('treats regex metacharacters in region as literal text', async () => {
      groupModel.find.mockReturnValue(q([]));

      await service.list('u1', { region: 'Yan.on' });

      const rx = groupModel.find.mock.calls[0][0].$or[0].country;
      expect(rx.test('Yangon')).toBe(false); // '.' must not act as a wildcard
      expect(rx.test('Yan.on')).toBe(true);
    });
  });
});
