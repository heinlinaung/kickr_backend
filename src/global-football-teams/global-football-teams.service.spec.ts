// src/global-football-teams/global-football-teams.service.spec.ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { GlobalFootballTeamsService } from './global-football-teams.service';
import {
  GlobalFootballTeam,
  GlobalFootballTeamSchema,
} from './schemas/global-football-team.schema';

describe('GlobalFootballTeamsService', () => {
  let service: GlobalFootballTeamsService;
  const teamModel: any = {};
  const query: any = {};

  beforeEach(async () => {
    jest.clearAllMocks();
    query.select = jest.fn().mockReturnThis();
    query.sort = jest.fn().mockReturnThis();
    query.lean = jest.fn().mockResolvedValue([]);
    teamModel.find = jest.fn().mockReturnValue(query);

    const m = await Test.createTestingModule({
      providers: [
        GlobalFootballTeamsService,
        {
          provide: getModelToken(GlobalFootballTeam.name),
          useValue: teamModel,
        },
      ],
    }).compile();
    service = m.get(GlobalFootballTeamsService);
  });

  it('sorts by sortOrder, with name as the tiebreaker', async () => {
    // The intended order is by league standing, not alphabetical, so the sort
    // must lead with sortOrder. `name` makes the ordering total — rows sharing
    // a sortOrder would otherwise come back in storage-engine order, which can
    // differ between identical requests.
    await service.findAll();

    expect(query.sort).toHaveBeenCalledWith({ sortOrder: 1, name: 1 });
  });

  it('returns the whole list unfiltered and unpaginated', async () => {
    // A fixed ~20-row reference list fills one picker; paginating it would
    // make every consumer loop to render a dropdown.
    await service.findAll();

    expect(teamModel.find).toHaveBeenCalledWith();
    expect(query.lean).toHaveBeenCalled();
  });

  it('projects only name and sortOrder', async () => {
    // Keeps timestamps and __v off the wire; the client needs an id, a label
    // and an order.
    await service.findAll();

    expect(query.select).toHaveBeenCalledWith('name sortOrder');
  });

  it('returns [] for an unseeded collection rather than throwing', async () => {
    const res = await service.findAll();

    expect(res).toEqual([]);
  });
});

describe('GlobalFootballTeam schema', () => {
  const paths = GlobalFootballTeamSchema.paths;

  it('stores no numeric id from the source data', () => {
    // The source list had id 1..20. Mongo's _id is the identity; a second one
    // invites documents being referenced by the wrong key.
    expect(Object.keys(paths)).not.toContain('id');
  });

  it('requires name and sortOrder', () => {
    expect(paths.name.isRequired).toBe(true);
    expect(paths.sortOrder.isRequired).toBe(true);
  });

  it('makes name unique, which is what keeps the seed idempotent', () => {
    // Re-running the seeder must not create a second "Arsenal".
    expect((paths.name as any).options.unique).toBe(true);
  });

  it('does NOT make sortOrder unique', () => {
    // Two clubs sharing a position is a display quirk, not a data error, and
    // enforcing it would turn a reshuffle into a multi-step migration.
    expect((paths.sortOrder as any).options.unique).toBeUndefined();
  });

  it('pins the collection name the seeder writes to', () => {
    // The seed script targets this literal string; a rename here without one
    // there would leave the API reading an empty collection.
    expect(GlobalFootballTeamSchema.get('collection')).toBe(
      'globalfootballteams',
    );
  });
});
