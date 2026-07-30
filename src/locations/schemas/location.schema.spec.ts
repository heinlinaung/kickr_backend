import { model, Types } from 'mongoose';
import { LocationSchema } from './location.schema';

describe('Location schema', () => {
  it('has the authored + derived paths', () => {
    const paths = Object.keys(LocationSchema.paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        'name',
        'lat',
        'lng',
        'url',
        'metadata',
        'createdBy',
      ]),
    );
  });

  it('requires name, lat, lng and createdBy', () => {
    expect(LocationSchema.path('name').isRequired).toBe(true);
    expect(LocationSchema.path('lat').isRequired).toBe(true);
    expect(LocationSchema.path('lng').isRequired).toBe(true);
    expect(LocationSchema.path('createdBy').isRequired).toBe(true);
  });

  it('derives geo [lng, lat] from lat/lng on validate', async () => {
    const M = model('LocationSpec', LocationSchema);
    const inst = new M({
      name: 'Pitch',
      lat: 13.7563,
      lng: 100.5018,
      createdBy: new Types.ObjectId(),
    });
    await inst.validate();
    expect((inst as any).geo.type).toBe('Point');
    expect((inst as any).geo.coordinates).toEqual([100.5018, 13.7563]);
  });
});
