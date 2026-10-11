import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateProfileDto } from './update-profile.dto';

describe('UpdateProfileDto whitelist + validation', () => {
  it('accepts valid footballPosition entries and rejects an invalid one', () => {
    // Arrays since 2026-10-11 — a player covers more than one position.
    expect(
      validateSync(
        plainToInstance(UpdateProfileDto, {
          footballPosition: ['goalkeeper', 'defender'],
        }),
      ),
    ).toHaveLength(0);
    expect(
      validateSync(
        plainToInstance(UpdateProfileDto, { footballPosition: ['striker'] }),
      ).length,
    ).toBeGreaterThan(0);
    // The old single-string shape is no longer accepted.
    expect(
      validateSync(
        plainToInstance(UpdateProfileDto, { footballPosition: 'goalkeeper' }),
      ).length,
    ).toBeGreaterThan(0);
  });

  it('preferredSport is an array of strings now', () => {
    expect(
      validateSync(
        plainToInstance(UpdateProfileDto, {
          preferredSport: ['football', 'futsal'],
        }),
      ),
    ).toHaveLength(0);
    expect(
      validateSync(
        plainToInstance(UpdateProfileDto, { preferredSport: 'football' }),
      ).length,
    ).toBeGreaterThan(0);
  });

  it('global-style whitelist strips identity + unknown fields', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    });
    const out: any = await pipe.transform(
      {
        email: 'a@evil.com',
        cognitoSub: 'x',
        emailVerified: true,
        inviteCode: 'y',
        biography: 'ok',
        footballPosition: ['goalkeeper'],
      },
      { type: 'body', metatype: UpdateProfileDto },
    );
    expect(out.email).toBeUndefined();
    expect(out.cognitoSub).toBeUndefined();
    expect(out.emailVerified).toBeUndefined();
    expect(out.inviteCode).toBeUndefined();
    expect(out.biography).toBe('ok');
    expect(out.footballPosition).toEqual(['goalkeeper']);
  });
});
