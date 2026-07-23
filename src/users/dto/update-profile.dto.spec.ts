import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateProfileDto } from './update-profile.dto';

describe('UpdateProfileDto whitelist + validation', () => {
  it('accepts a valid footballPosition and rejects an invalid one', () => {
    expect(
      validateSync(
        plainToInstance(UpdateProfileDto, { footballPosition: 'goalkeeper' }),
      ),
    ).toHaveLength(0);
    expect(
      validateSync(
        plainToInstance(UpdateProfileDto, { footballPosition: 'striker' }),
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
        footballPosition: 'goalkeeper',
      },
      { type: 'body', metatype: UpdateProfileDto },
    );
    expect(out.email).toBeUndefined();
    expect(out.cognitoSub).toBeUndefined();
    expect(out.emailVerified).toBeUndefined();
    expect(out.inviteCode).toBeUndefined();
    expect(out.biography).toBe('ok');
    expect(out.footballPosition).toBe('goalkeeper');
  });
});
