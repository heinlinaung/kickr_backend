// src/users/users.search.spec.ts
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { BadRequestException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { UsersService } from './users.service';
import { User } from './schemas/user.schema';
import { EventPlayer } from '../events/schemas/event-player.schema';
import { Event } from '../events/schemas/event.schema';
import { GlobalFootballTeam } from '../global-football-teams/schemas/global-football-team.schema';
import { ImageKitService } from '../common/upload/imagekit.service';
import { ConfigService } from '@nestjs/config';

describe('UsersService.search', () => {
  let service: UsersService;
  const userModel: any = {};

  /** find(...).sort(...).select(...).limit(...).lean() */
  const chain = (rows: any[]) => ({
    sort: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(rows),
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    userModel.find = jest.fn().mockReturnValue(chain([]));

    const m = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(EventPlayer.name), useValue: {} },
        { provide: getModelToken(Event.name), useValue: {} },
        // Search never touches favouriteTeamId; present only to satisfy DI.
        { provide: getModelToken(GlobalFootballTeam.name), useValue: {} },
        { provide: ImageKitService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();
    service = m.get(UsersService);
  });

  const filter = () => userModel.find.mock.calls[0][0];

  it('matches name, username and displayName case-insensitively', async () => {
    await service.search('hein');

    const or = filter().$or;
    expect(or.map((c: any) => Object.keys(c)[0])).toEqual([
      'name',
      'username',
      'displayName',
    ]);
    expect(or[0].name.flags).toContain('i');
    expect(or[0].name.test('HEINrich')).toBe(true);
  });

  it('returns an empty page for an empty query without touching the database', async () => {
    // An empty regex matches every user — that is a dump, not a search.
    const empty = { items: [], nextCursor: null, hasMore: false };
    await expect(service.search('')).resolves.toEqual(empty);
    await expect(service.search('   ')).resolves.toEqual(empty);
    expect(userModel.find).not.toHaveBeenCalled();
  });

  it('excludes users whose profile is private', async () => {
    // getPublicProfile 404s them, so listing them would advertise accounts
    // that cannot be opened.
    await service.search('hein');
    expect(filter()['privacy.profileVisibility']).toEqual({ $ne: 'private' });
  });

  it('treats regex metacharacters as literal text', async () => {
    await service.search('a.c');
    const rx = filter().$or[0].name;
    expect(rx.test('abc')).toBe(false);
    expect(rx.test('a.c')).toBe(true);
  });

  describe('email', () => {
    it('matches an email EXACTLY, never as a substring', async () => {
      await service.search('hein@example.com');

      const emailClause = filter().$or.find((c: any) => 'email' in c);
      // A string, not a RegExp — a partial match would let anyone enumerate
      // registered addresses.
      expect(emailClause.email).toBe('hein@example.com');
      expect(emailClause.email).not.toBeInstanceOf(RegExp);
    });

    it('lowercases the address, since emails are stored lowercase', async () => {
      await service.search('Hein@Example.COM');
      const emailClause = filter().$or.find((c: any) => 'email' in c);
      expect(emailClause.email).toBe('hein@example.com');
    });

    it('does not add an email clause when the term is not an address', async () => {
      await service.search('hein');
      expect(filter().$or.some((c: any) => 'email' in c)).toBe(false);
    });

    it('cannot be used to enumerate by domain', async () => {
      // '@gmail.com' contains '@', so it becomes an EXACT match — which will
      // match nobody, rather than every gmail user.
      await service.search('@gmail.com');
      const emailClause = filter().$or.find((c: any) => 'email' in c);
      expect(emailClause.email).toBe('@gmail.com');
      expect(emailClause.email).not.toBeInstanceOf(RegExp);
    });

    it('never selects the email field into the result', async () => {
      await service.search('hein@example.com');
      const selected = userModel.find.mock.results[0].value.select.mock
        .calls[0][0] as string;

      for (const secret of ['email', 'phoneNumber', 'cognitoSub', 'privacy']) {
        expect(selected.split(' ')).not.toContain(secret);
      }
      expect(selected.split(' ')).toContain('name');
    });
  });

  describe('limit', () => {
    const limitArg = () =>
      userModel.find.mock.results[0].value.limit.mock.calls[0][0];

    it('defaults to 20', async () => {
      await service.search('hein');
      expect(limitArg()).toBe(21);
    });

    it('caps at 50 however large the request', async () => {
      await service.search('hein', 5000);
      expect(limitArg()).toBe(51);
    });

    it('floors at 1 for zero or negative', async () => {
      await service.search('hein', 0);
      expect(limitArg()).toBe(2);
    });

    it('falls back to the default for a non-numeric limit', async () => {
      // `?limit=abc` reaches the service as NaN. The clamp cannot catch it —
      // every NaN comparison is false — so it must be rejected explicitly,
      // or Mongoose receives .limit(NaN).
      await service.search('hein', Number('abc'));
      expect(limitArg()).toBe(21);
    });

    it('falls back to the default for Infinity', async () => {
      // Treated as unusable input rather than "as many as possible".
      await service.search('hein', Infinity);
      expect(limitArg()).toBe(21);
    });

    it('truncates a fractional limit', async () => {
      await service.search('hein', 2.7);
      expect(limitArg()).toBe(3);
    });
  });

  describe('cursor pagination', () => {
    /** Real ObjectIds — the cursor validates _id before it reaches Mongoose. */
    const rows = (n: number) =>
      Array.from({ length: n }, () => ({
        _id: new Types.ObjectId(),
        name: 'Hein',
      }));

    it('sorts by _id so the order is total and stable', async () => {
      // No text score and no date to rank on, so _id is the only stable key.
      // Without a deterministic sort, pages would overlap and drop users.
      await service.search('hein');
      const sortArg =
        userModel.find.mock.results[0].value.sort.mock.calls[0][0];
      expect(sortArg).toEqual({ _id: 1 });
    });

    it('returns a paged envelope, not a bare array', async () => {
      userModel.find.mockReturnValue(chain(rows(3)));

      const res: any = await service.search('hein', 2);

      expect(Array.isArray(res)).toBe(false);
      expect(res.items).toHaveLength(2);
      expect(res.hasMore).toBe(true);
      expect(typeof res.nextCursor).toBe('string');
    });

    it('reports the end of the result set', async () => {
      userModel.find.mockReturnValue(chain(rows(2)));

      const res: any = await service.search('hein', 5);
      expect(res.hasMore).toBe(false);
      expect(res.nextCursor).toBeNull();
    });

    it('adds no keyset predicate on the first page', async () => {
      await service.search('hein');
      expect(filter().$and).toBeUndefined();
    });

    it('resumes strictly after the cursor row', async () => {
      const id = new Types.ObjectId();
      const cursor = Buffer.from(
        JSON.stringify({ i: id.toString() }),
      ).toString('base64url');

      await service.search('hein', 20, cursor);

      // Keyset, not skip. Kept in $and so it cannot clobber the match $or.
      expect(filter().$and[0]._id.$gt.toString()).toBe(id.toString());
      expect(filter().$or).toBeDefined();
    });

    it('round-trips its own cursor', async () => {
      userModel.find.mockReturnValue(chain(rows(3)));
      const first: any = await service.search('hein', 2);

      jest.clearAllMocks();
      userModel.find.mockReturnValue(chain(rows(1)));
      await service.search('hein', 2, first.nextCursor);

      expect(userModel.find.mock.calls[0][0].$and).toBeDefined();
    });

    it('rejects a malformed cursor', async () => {
      await expect(
        service.search('hein', 20, 'not-a-cursor'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a cursor whose _id is not an ObjectId', async () => {
      // Cursors are unsigned, so a hand-crafted one must not reach the caster.
      const forged = Buffer.from(JSON.stringify({ i: 'nope' })).toString(
        'base64url',
      );
      await expect(
        service.search('hein', 20, forged),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
