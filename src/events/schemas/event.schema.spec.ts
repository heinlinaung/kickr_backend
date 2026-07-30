import { EventSchema } from './event.schema';

describe('Event schema (location ref migration)', () => {
  it('replaces the flat location trio with a locationId ref', () => {
    const paths = Object.keys(EventSchema.paths);
    expect(paths).toContain('locationId');
    expect(paths).not.toContain('locationName');
    expect(paths).not.toContain('latitude');
    expect(paths).not.toContain('longitude');
  });

  it('locationId refs Location and defaults to null', () => {
    const path: any = EventSchema.path('locationId');
    expect(path.options.ref).toBe('Location');
    expect(path.options.default).toBeNull();
  });
});
