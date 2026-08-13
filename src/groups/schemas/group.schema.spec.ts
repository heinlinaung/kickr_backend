import { GroupSchema } from './group.schema';
import { GroupMemberSchema } from './group-member.schema';

describe('Group schema (v2 extensions)', () => {
  it('adds logo/sportType/handle/rules/locations', () => {
    const paths = Object.keys(GroupSchema.paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        'logo',
        'logoFileId',
        'wallpaperFileId',
        'sportType',
        'handle',
        'rules',
        'locations',
      ]),
    );
  });

  it('removes the flat location fields', () => {
    const paths = Object.keys(GroupSchema.paths);
    expect(paths).not.toContain('locationName');
    expect(paths).not.toContain('latitude');
    expect(paths).not.toContain('longitude');
  });
});

describe('GroupMember schema (roles + levels)', () => {
  it('role enum covers every assignable role', () => {
    expect(GroupMemberSchema.path('role').options.enum).toEqual([
      'owner',
      'admin',
      'captain',
      'vice-captain',
      'member',
    ]);
  });

  it('has a level defaulting to 1, enum 1|2|3', () => {
    const level: any = GroupMemberSchema.path('level');
    expect(level).toBeDefined();
    expect(level.options.default).toBe(1);
    expect(level.options.enum).toEqual([1, 2, 3]);
  });
});
