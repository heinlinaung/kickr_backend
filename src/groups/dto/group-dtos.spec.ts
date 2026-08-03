import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateGroupDto } from './create-group.dto';
import { UpdateGroupDto } from './update-group.dto';
import { UpdateMemberRoleDto } from './update-member-role.dto';

// Mirrors the global pipe configured in src/main.ts
const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
});

const run = (metatype: any, body: any) =>
  pipe.transform(body, { type: 'body', metatype });

/** Resolves to the flattened validation messages for a rejected payload. */
async function expectRejected(metatype: any, body: any): Promise<string> {
  try {
    await run(metatype, body);
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return JSON.stringify((e as BadRequestException).getResponse());
  }
  throw new Error(
    `expected ${metatype.name} to reject ${JSON.stringify(body)} but it was accepted`,
  );
}

describe('CreateGroupDto', () => {
  it('rejects the removed flat location fields instead of silently dropping them', async () => {
    for (const field of ['locationName', 'latitude', 'longitude']) {
      const msg = await expectRejected(CreateGroupDto, {
        name: 'Bangkok FC',
        [field]: field === 'locationName' ? 'Lumpini Park' : 13.7563,
      });
      expect(msg).toContain(`property ${field} should not exist`);
    }
  });

  it('accepts locationIds (max 5 mongo ids) in place of the flat trio', async () => {
    const ids = ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012'];
    const out: any = await run(CreateGroupDto, {
      name: 'Bangkok FC',
      locationIds: ids,
    });
    expect(out.locationIds).toEqual(ids);

    expect(
      await expectRejected(CreateGroupDto, {
        name: 'Bangkok FC',
        locationIds: ['not-an-id'],
      }),
    ).toContain('locationIds');

    expect(
      await expectRejected(CreateGroupDto, {
        name: 'Bangkok FC',
        locationIds: new Array(6).fill('507f1f77bcf86cd799439011'),
      }),
    ).toContain('locationIds');
  });

  it('rejects a handle with spaces/uppercase, accepts a slug handle', async () => {
    expect(
      await expectRejected(CreateGroupDto, {
        name: 'Bangkok FC',
        handle: 'Bangkok FC',
      }),
    ).toContain(
      'handle must be lowercase alphanumeric, dot, dash or underscore',
    );

    const out: any = await run(CreateGroupDto, {
      name: 'Bangkok FC',
      handle: 'bangkok-fc',
    });
    expect(out.handle).toBe('bangkok-fc');
  });

  it('rejects an unknown sportType, accepts football', async () => {
    expect(
      await expectRejected(CreateGroupDto, {
        name: 'Bangkok FC',
        sportType: 'cricket',
      }),
    ).toContain('sportType');

    const out: any = await run(CreateGroupDto, {
      name: 'Bangkok FC',
      sportType: 'football',
    });
    expect(out.sportType).toBe('football');
  });
});

describe('UpdateGroupDto', () => {
  it('accepts more than 3 teamRules — the cap was removed', async () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'];
    const out: any = await run(UpdateGroupDto, { teamRules: six });
    expect(out.teamRules).toEqual(six);
  });

  it('accepts country and city', async () => {
    const out: any = await run(UpdateGroupDto, {
      country: 'Myanmar',
      city: 'Yangon',
    });
    expect(out.country).toBe('Myanmar');
    expect(out.city).toBe('Yangon');
  });

  it('rejects non-string rule entries', async () => {
    expect(
      await expectRejected(UpdateGroupDto, { teamRules: ['a', 5] }),
    ).toContain('teamRules');
  });

  it('accepts sportType/handle/isPrivate', async () => {
    const out: any = await run(UpdateGroupDto, {
      sportType: 'padel',
      handle: 'bkk.fc_2',
      isPrivate: true,
    });
    expect(out).toMatchObject({
      sportType: 'padel',
      handle: 'bkk.fc_2',
      isPrivate: true,
    });
  });
});

describe('UpdateMemberRoleDto', () => {
  it("rejects role 'owner' — ownership is not transferable via this DTO", async () => {
    expect(
      await expectRejected(UpdateMemberRoleDto, { role: 'owner' }),
    ).toContain('role');
  });

  it('accepts admin/captain/member and coerces level from a string', async () => {
    for (const role of ['admin', 'captain', 'member']) {
      const out: any = await run(UpdateMemberRoleDto, { role });
      expect(out.role).toBe(role);
    }
    const out: any = await run(UpdateMemberRoleDto, { level: '3' });
    expect(out.level).toBe(3);
  });

  it('rejects an out-of-range level', async () => {
    expect(await expectRejected(UpdateMemberRoleDto, { level: 4 })).toContain(
      'level',
    );
  });
});

describe('CreateGroupDto — teamRules', () => {
  it('accepts any number of rules (no cap)', async () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'];
    const out: any = await run(CreateGroupDto, { name: 'FC', teamRules: six });
    expect(out.teamRules).toEqual(six);
  });

  it('preserves newlines and non-ASCII text in a rule', async () => {
    const rules = [
      '\u1015\u103d\u1032\u1019\u1010\u102d\u102f\u1004\u103a\u1001\u1004\u103a ( 15-30 ) \u1019\u102d\u1014\u1005\u103a\n\u1005\u1031\u102c\u1015\u103c\u102e\u1038',
      'a\n\nb',
    ];
    const out: any = await run(CreateGroupDto, {
      name: 'FC',
      teamRules: rules,
    });
    expect(out.teamRules[0]).toBe(rules[0]);
    expect(out.teamRules[1]).toBe('a\n\nb');
  });

  it('rejects non-string entries', async () => {
    expect(
      await expectRejected(CreateGroupDto, {
        name: 'FC',
        teamRules: ['ok', 42],
      }),
    ).toContain('teamRules');
  });

  it('is optional', async () => {
    const out: any = await run(CreateGroupDto, { name: 'FC' });
    expect(out.teamRules).toBeUndefined();
  });
});
