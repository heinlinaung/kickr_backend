import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
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
    // list() resolves the caller's roster first, so it can widen visibility to
    // the events they joined.
    playerModel.find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });
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
  // A real 24-char hex id: findById validates before casting, so the old 'e1'
  // placeholder would now (correctly) 404.
  const EVENT_ID = '507f1f77bcf86cd799439011';

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
    // list() resolves the caller's roster first, so it can widen visibility to
    // the events they joined.
    playerModel.find = jest.fn().mockReturnValue(q([]));

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

  describe('findById → malformed id', () => {
    it('404s instead of throwing a raw cast error', async () => {
      // A mistyped static segment (e.g. /events/mine) falls through to
      // @Get(':id'); casting it would surface a BSONError as a 500.
      await expect(service.findById('mine')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(eventModel.findById).not.toHaveBeenCalled();
    });
  });

  describe('findById → joinedByMe', () => {
    const anEvent = () =>
      eventModel.findById.mockReturnValue(q({ _id: EVENT_ID, groupId: null }));

    it('is true when the caller is on the roster', async () => {
      anEvent();
      playerModel.exists.mockResolvedValue({ _id: 'p1' });

      const res: any = await service.findById(EVENT_ID, CALLER);

      expect(res.joinedByMe).toBe(true);
    });

    it('is false when the caller has not joined', async () => {
      anEvent();
      playerModel.exists.mockResolvedValue(null);

      const res: any = await service.findById(EVENT_ID, CALLER);

      expect(res.joinedByMe).toBe(false);
    });

    it("only counts a 'joined' row, not a cancelled one", async () => {
      // Leaving sets status 'cancelled' and keeps the row for reactivation, so
      // its mere presence is not membership.
      anEvent();
      await service.findById(EVENT_ID, CALLER);

      expect(playerModel.exists).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'joined' }),
      );
    });

    it('is false — never undefined — when there is no caller', async () => {
      anEvent();

      const res: any = await service.findById(EVENT_ID);

      expect(res.joinedByMe).toBe(false);
      expect(playerModel.exists).not.toHaveBeenCalled();
    });

    it('is independent of the group role', async () => {
      // A group owner who never joined must still read as not joined — the
      // gap that prompted this field.
      eventModel.findById.mockReturnValue(q({ _id: EVENT_ID, groupId: GROUP_ID }));
      groupModel.findById.mockReturnValue(q({ rules: '' }));
      memberModel.findOne = jest
        .fn()
        .mockReturnValue(q({ role: 'owner', status: 'approved' }));
      playerModel.exists.mockResolvedValue(null);

      const res: any = await service.findById(EVENT_ID, CALLER);

      expect(res.userRole).toBe('owner');
      expect(res.joinedByMe).toBe(false);
    });
  });

  describe('findById → groupRules', () => {
    it("attaches the parent group's rules as text", async () => {
      const rules = 'No smoking\nArrive 15 min early\n(or tell the captain)';
      eventModel.findById.mockReturnValue(q({ _id: EVENT_ID, groupId: GROUP_ID }));
      groupModel.findById.mockReturnValue(q({ rules }));

      const res: any = await service.findById(EVENT_ID);

      expect(res.groupRules).toBe(rules);
      // Newlines must survive to the client — rules are now one text block.
      expect(res.groupRules).toContain('\n');
    });

    it("returns '' for an event with no group, never null", async () => {
      eventModel.findById.mockReturnValue(q({ _id: EVENT_ID, groupId: null }));

      const res: any = await service.findById(EVENT_ID);

      expect(res.groupRules).toBe('');
      expect(groupModel.findById).not.toHaveBeenCalled();
    });

    it("returns '' when the group has no rules set", async () => {
      eventModel.findById.mockReturnValue(q({ _id: EVENT_ID, groupId: GROUP_ID }));
      groupModel.findById.mockReturnValue(q({}));

      const res: any = await service.findById(EVENT_ID);

      expect(res.groupRules).toBe('');
    });
  });

  describe('findById → group branding', () => {
    const branding = {
      _id: GROUP_ID,
      name: 'Sunday Ballers',
      logo: 'https://ik.imagekit.io/kickr/logo.png',
      wallpaper: 'https://ik.imagekit.io/kickr/wall.jpg',
      rules: 'Be on time',
    };

    it('attaches the group name, logo and wallpaper', async () => {
      eventModel.findById.mockReturnValue(q({ _id: EVENT_ID, groupId: GROUP_ID }));
      groupModel.findById.mockReturnValue(q(branding));

      const res: any = await service.findById(EVENT_ID);

      expect(res.group).toEqual({
        _id: GROUP_ID,
        name: 'Sunday Ballers',
        logo: branding.logo,
        wallpaper: branding.wallpaper,
      });
    });

    it('fetches branding and rules in ONE group query', async () => {
      // The rules projection was already here; the branding fields ride along
      // rather than costing a second round trip on every detail request.
      eventModel.findById.mockReturnValue(q({ _id: EVENT_ID, groupId: GROUP_ID }));
      const chain = q(branding);
      groupModel.findById.mockReturnValue(chain);

      await service.findById(EVENT_ID);

      expect(groupModel.findById).toHaveBeenCalledTimes(1);
      expect(chain.select).toHaveBeenCalledWith('rules name logo wallpaper');
    });

    it('does NOT leak the internal ImageKit file ids', async () => {
      // logoFileId/wallpaperFileId are storage handles used for deletion, not
      // client data — the projection must not widen to the whole document.
      eventModel.findById.mockReturnValue(q({ _id: EVENT_ID, groupId: GROUP_ID }));
      groupModel.findById.mockReturnValue(
        q({ ...branding, logoFileId: 'file_123', wallpaperFileId: 'file_456' }),
      );

      const res: any = await service.findById(EVENT_ID);

      expect(res.group).not.toHaveProperty('logoFileId');
      expect(res.group).not.toHaveProperty('wallpaperFileId');
      expect(res.group).not.toHaveProperty('rules');
    });

    it('reports null for images the group has not set', async () => {
      // null, not '': an unset image is absent rather than empty.
      eventModel.findById.mockReturnValue(q({ _id: EVENT_ID, groupId: GROUP_ID }));
      groupModel.findById.mockReturnValue(q({ _id: GROUP_ID, name: 'Bare' }));

      const res: any = await service.findById(EVENT_ID);

      expect(res.group.logo).toBeNull();
      expect(res.group.wallpaper).toBeNull();
      expect(res.group.name).toBe('Bare');
    });

    it('is null for a standalone event, and queries no group', async () => {
      // The absence is the meaningful answer here, unlike groupRules which
      // flattens to '' because it is always renderable.
      eventModel.findById.mockReturnValue(q({ _id: EVENT_ID, groupId: null }));

      const res: any = await service.findById(EVENT_ID);

      expect(res.group).toBeNull();
      expect(groupModel.findById).not.toHaveBeenCalled();
    });

    it('is null when the groupId points at a deleted group', async () => {
      // A dangling groupId must not crash detail — the event still renders.
      eventModel.findById.mockReturnValue(q({ _id: EVENT_ID, groupId: GROUP_ID }));
      groupModel.findById.mockReturnValue(q(null));

      const res: any = await service.findById(EVENT_ID);

      expect(res.group).toBeNull();
      expect(res.groupRules).toBe('');
    });

    it('keeps groupRules at the top level, unmoved', async () => {
      // Additive change: an existing client reading groupRules must not break.
      eventModel.findById.mockReturnValue(q({ _id: EVENT_ID, groupId: GROUP_ID }));
      groupModel.findById.mockReturnValue(q(branding));

      const res: any = await service.findById(EVENT_ID);

      expect(res.groupRules).toBe('Be on time');
    });
  });

  describe('list → finished events', () => {
    const statusOf = () =>
      (eventModel.find.mock.calls.at(-1)[0] as any).status;

    it('hides after_match and done by default', async () => {
      // A played fixture is history, not something to turn up to. Both states
      // mean the match happened; only the result is outstanding in after_match.
      eventModel.find.mockReturnValue(q([]));

      await service.list('u1');

      expect(statusOf()).toEqual({ $nin: ['after_match', 'done'] });
    });

    it.each(['after_match', 'done'])(
      'still returns %s when asked for explicitly',
      async (status) => {
        // Hiding by default must not make them unreachable — the history
        // screen has no other query to run.
        eventModel.find.mockReturnValue(q([]));

        await service.list('u1', { status });

        expect(statusOf()).toBe(status);
      },
    );

    it('does not widen the exclusion to live states', async () => {
      // Guards against someone adding a state to FINISHED_STATUSES that
      // players can still act on.
      eventModel.find.mockReturnValue(q([]));

      await service.list('u1');

      const excluded = statusOf().$nin;
      for (const live of ['join', 'preparation', 'ready_to_play', 'playing']) {
        expect(excluded).not.toContain(live);
      }
    });

    it('keeps the exclusion when other filters narrow the query', async () => {
      // The status default sits alongside the region/date narrowings rather
      // than being replaced by them.
      groupModel.find.mockReturnValue(q([{ _id: GROUP_ID }]));
      eventModel.find.mockReturnValue(q([]));

      await service.list('u1', { region: 'yangon' });

      expect(statusOf()).toEqual({ $nin: ['after_match', 'done'] });
      expect(eventModel.find.mock.calls.at(-1)[0]).toHaveProperty('groupId');
    });
  });

  describe('list → ?region=', () => {
    it('does not filter by group when region is absent', async () => {
      eventModel.find.mockReturnValue(q([]));

      await service.list('u1');

      // A finished fixture is excluded by default, so the filter is the
      // visibility clause AND the status exclusion.
      expect(eventModel.find).toHaveBeenCalledWith({
        isPublic: true,
        status: { $nin: ['after_match', 'done'] },
      });
      expect(groupModel.find).not.toHaveBeenCalled();
    });

    it('matches a region against country OR city', async () => {
      groupModel.find.mockReturnValue(q([{ _id: GROUP_ID }]));
      eventModel.find.mockReturnValue(q([{ _id: 'e1' }]));

      await service.list('u1', { region: 'yangon' });

      const groupFilter = groupModel.find.mock.calls[0][0];
      expect(groupFilter.$or).toHaveLength(2);
      // Exact match on the canonical lowercase form, not a regex — country and
      // city are stored lowercase, so this can use the {country, city} index.
      expect(groupFilter.$or).toEqual([
        { country: 'yangon' },
        { city: 'yangon' },
      ]);

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
      expect(eventModel.find).toHaveBeenCalledWith({
        isPublic: true,
        status: { $nin: ['after_match', 'done'] },
      });
    });

    it('normalises the caller\'s casing to the stored lowercase form', async () => {
      // Values are stored lowercase, so a caller typing "Yangon" must still
      // match. Previously handled by an /i regex; now by normalising the input.
      groupModel.find.mockReturnValue(q([]));

      await service.list('u1', { region: '  YaNgOn  ' });

      expect(groupModel.find.mock.calls[0][0].$or).toEqual([
        { country: 'yangon' },
        { city: 'yangon' },
      ]);
    });

    it('treats regex metacharacters as literal text', async () => {
      // No regex is built any more, so '.' cannot act as a wildcard — but the
      // guarantee still matters, so it stays asserted.
      groupModel.find.mockReturnValue(q([]));

      await service.list('u1', { region: 'Yan.on' });

      const [byCountry] = groupModel.find.mock.calls[0][0].$or;
      expect(byCountry.country).toBe('yan.on');
      expect(byCountry.country).not.toBeInstanceOf(RegExp);
    });
  });
});
