// src/users/users.search.spec.ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { UsersService } from './users.service';
import { User } from './schemas/user.schema';
import { EventPlayer } from '../events/schemas/event-player.schema';
import { Event } from '../events/schemas/event.schema';
import { ImageKitService } from '../common/upload/imagekit.service';
import { ConfigService } from '@nestjs/config';

describe('UsersService.search', () => {
  let service: UsersService;
  const userModel: any = {};

  /** find(...).select(...).limit(...).lean() */
  const chain = (rows: any[]) => ({
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

  it('returns [] for an empty query without touching the database', async () => {
    // An empty regex matches every user — that is a dump, not a search.
    await expect(service.search('')).resolves.toEqual([]);
    await expect(service.search('   ')).resolves.toEqual([]);
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
      expect(limitArg()).toBe(20);
    });

    it('caps at 50 however large the request', async () => {
      await service.search('hein', 5000);
      expect(limitArg()).toBe(50);
    });

    it('floors at 1 for zero or negative', async () => {
      await service.search('hein', 0);
      expect(limitArg()).toBe(1);
    });
  });
});
