// src/events/event-new-fields.spec.ts
import { ValidationPipe } from '@nestjs/common';
import { CreateEventDto } from './dto/create-event.dto';
import { CreateEventTemplateDto } from './dto/create-event-template.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { EventSchema } from './schemas/event.schema';
import { FOOTBALL_SUB_TYPES } from './events.lifecycle';

/** The app's global pipe config, so these match production behaviour. */
const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
});

const validCreate = {
  title: 'Friday five',
  date: '2026-09-27T00:00:00.000Z',
};

const create = (over: Record<string, unknown>) =>
  pipe.transform(
    { ...validCreate, ...over },
    {
      type: 'body',
      metatype: CreateEventDto,
    },
  );

const update = (over: Record<string, unknown>) =>
  pipe.transform(over, { type: 'body', metatype: UpdateEventDto });

describe('registrationClosingDuration', () => {
  it('is accepted on create', async () => {
    const out: any = await create({ registrationClosingDuration: 120 });

    expect(out.registrationClosingDuration).toBe(120);
  });

  it('is accepted on update', async () => {
    // Settable but not editable would be a dead field — PATCH rejects unknown
    // properties, so omitting it from UpdateEventDto would 400 the client.
    const out: any = await update({ registrationClosingDuration: 30 });

    expect(out.registrationClosingDuration).toBe(30);
  });

  it('accepts 0, meaning registration never closes early', async () => {
    // 0 is the default and the pre-existing behaviour, so it must be a legal
    // value to send explicitly, not just an absent one.
    const out: any = await create({ registrationClosingDuration: 0 });

    expect(out.registrationClosingDuration).toBe(0);
  });

  it('rejects a negative offset', async () => {
    await expect(create({ registrationClosingDuration: -1 })).rejects.toThrow();
  });

  it('rejects a fractional value', async () => {
    await expect(
      create({ registrationClosingDuration: 1.5 }),
    ).rejects.toThrow();
  });

  it('rejects an offset longer than a week', async () => {
    // 10080 minutes. Anything larger is far more likely a unit mix-up — hours
    // or days entered as minutes — than a real intention.
    await expect(
      create({ registrationClosingDuration: 10081 }),
    ).rejects.toThrow();
    await expect(
      create({ registrationClosingDuration: 10080 }),
    ).resolves.toBeDefined();
  });

  it('is optional', async () => {
    const out: any = await create({});

    expect(out.registrationClosingDuration).toBeUndefined();
  });

  it('defaults to 0 on the schema, not null', async () => {
    // Distinct from subType, which defaults to null: "no early close" is a real
    // answer, whereas an unspecified football format is genuinely unknown.
    expect(
      EventSchema.path('registrationClosingDuration').options.default,
    ).toBe(0);
  });

  it('is a DIFFERENT field from duration', async () => {
    // Same unit, opposite direction — the pairing most likely to be confused.
    const out: any = await create({
      duration: 90,
      registrationClosingDuration: 120,
    });

    expect(out.duration).toBe(90);
    expect(out.registrationClosingDuration).toBe(120);
  });
});

describe('subType — football format', () => {
  it.each([...FOOTBALL_SUB_TYPES])('accepts %s', async (value) => {
    const out: any = await create({ sportType: 'football', subType: value });

    expect(out.subType).toBe(value);
  });

  it('passes an unknown value through — the SERVICE rejects it', async () => {
    // The DTO no longer carries a hardcoded enum: allowed formats live in the
    // `sporttypes` collection (each sport's `subTypes`), and
    // EventsService.create/update check against it. See events.service.spec
    // for the rejection.
    const out: any = await create({ sportType: 'football', subType: 'beach' });

    expect(out.subType).toBe('beach');
  });

  it('is optional — omitting it means unspecified', async () => {
    const out: any = await create({ sportType: 'football' });

    expect(out.subType).toBeUndefined();
  });

  it('defaults to null on the schema, NOT to stadium', async () => {
    // An event created before this field existed did not choose stadium; it
    // said nothing. Defaulting to a real value would invent an answer.
    expect(EventSchema.path('subType').options.default).toBeNull();
  });

  it('is accepted on update too', async () => {
    const out: any = await update({ subType: 'futsal' });

    expect(out.subType).toBe('futsal');
  });

  it('is a separate field from sportType', async () => {
    // The overlap worth pinning: futsal exists BOTH as a top-level sportType
    // and as a football subType, so a client filtering for futsal must check
    // both. This asserts they are independently carried, not merged.
    const out: any = await create({ sportType: 'football', subType: 'futsal' });

    expect(out.sportType).toBe('football');
    expect(out.subType).toBe('futsal');
  });
});

describe('CreateEventTemplateDto — mirrors the event-create body', () => {
  const template = (over: Record<string, unknown>) =>
    pipe.transform(
      { name: 'Tuesday 5-a-side', ...over },
      { type: 'body', metatype: CreateEventTemplateDto },
    );

  it('accepts the full event-create-shaped body', async () => {
    // The exact request shape the client sends to POST /events, plus `name`.
    const out: any = await template({
      groupId: '665f1a2b3c4d5e6f7a8b9c0d',
      title: 'Friday Night Football',
      description: 'Casual 11v11 match at the park',
      date: '2026-07-01T18:00:00.000Z',
      isPublic: true,
      locationId: '507f1f77bcf86cd799439011',
      maxPlayers: 22,
      sportType: 'football',
      subType: 'stadium',
      skillLevel: 'beginner',
      price: 0,
      additionalPrice: 5,
      takeAdditionalPrice: false,
      isAllowExtraPlayer: false,
      duration: 90,
      registrationClosingDuration: 120,
    });

    expect(out.subType).toBe('stadium');
    expect(out.duration).toBe(90);
    expect(out.registrationClosingDuration).toBe(120);
    expect(out.date).toBe('2026-07-01T18:00:00.000Z');
  });

  it('REJECTS teamCount — removed from templates entirely', async () => {
    // forbidNonWhitelisted makes the removal loud: a client still sending it
    // gets a 400 naming the property, not a silent drop.
    await expect(template({ teamCount: 4 })).rejects.toThrow();
  });

  it('keeps only name required, like before', async () => {
    const out: any = await template({});

    expect(out.name).toBe('Tuesday 5-a-side');
  });

  it('bounds duration and registrationClosingDuration like event create', async () => {
    await expect(template({ duration: 30 })).rejects.toThrow();
    await expect(
      template({ registrationClosingDuration: 10081 }),
    ).rejects.toThrow();
  });
});
