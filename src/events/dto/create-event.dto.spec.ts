import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateEventDto } from './create-event.dto';

// Mirrors the global pipe configured in src/main.ts
const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
});

const run = (body: any) =>
  pipe.transform(body, { type: 'body', metatype: CreateEventDto });

const base = { title: 'Friday Night', date: '2026-07-01T18:00:00.000Z' };

describe('CreateEventDto (location ref migration)', () => {
  it('rejects the removed flat location fields instead of silently dropping them', async () => {
    for (const field of ['locationName', 'latitude', 'longitude']) {
      await expect(
        run({
          ...base,
          [field]: field === 'locationName' ? 'Lumpini Park' : 13.7563,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('accepts an optional locationId', async () => {
    const out: any = await run({
      ...base,
      locationId: '507f1f77bcf86cd799439011',
    });
    expect(out.locationId).toBe('507f1f77bcf86cd799439011');
  });

  it('rejects a locationId that is not a mongo id', async () => {
    await expect(run({ ...base, locationId: 'nope' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('is valid with no location at all', async () => {
    const out: any = await run({ ...base });
    expect(out.locationId).toBeUndefined();
  });
});
