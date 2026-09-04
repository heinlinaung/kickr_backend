// src/global-football-teams/global-football-teams.service.ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  GlobalFootballTeam,
  GlobalFootballTeamDocument,
} from './schemas/global-football-team.schema';

@Injectable()
export class GlobalFootballTeamsService {
  constructor(
    @InjectModel(GlobalFootballTeam.name)
    private teamModel: Model<GlobalFootballTeamDocument>,
  ) {}

  /**
   * The whole list, in display order.
   *
   * Deliberately unpaginated: this is a fixed reference list of twenty-odd
   * clubs that a client renders as a single picker. Paginating it would make
   * every consumer implement a loop to show one dropdown, and cursor
   * pagination exists here for feeds that grow without bound — this does not.
   *
   * Revisit if the list ever spans multiple leagues; at that point the useful
   * addition is a `?country=` or `?league=` filter rather than pages.
   */
  async findAll() {
    return this.teamModel
      .find()
      .select('name sortOrder')
      .sort({ sortOrder: 1, name: 1 })
      .lean();
  }
}
