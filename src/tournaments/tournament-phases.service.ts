import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Tournament, TournamentDocument } from './schemas/tournament.schema';
import {
  TournamentTeam,
  TournamentTeamDocument,
} from './schemas/tournament-team.schema';
import {
  TournamentPhase,
  TournamentPhaseDocument,
} from './schemas/tournament-phase.schema';
import {
  LeagueGroup,
  LeagueGroupDocument,
} from './schemas/league-group.schema';
import {
  LeagueGroupTeam,
  LeagueGroupTeamDocument,
} from './schemas/league-group-team.schema';
import {
  KnockoutRound,
  KnockoutRoundDocument,
} from './schemas/knockout-round.schema';
import {
  TournamentMatch,
  TournamentMatchDocument,
} from './schemas/tournament-match.schema';
import {
  QualificationResult,
  QualificationResultDocument,
} from './schemas/qualification-result.schema';
import {
  APPROVED_REGISTRATION,
  FORFEIT_SCORE,
  MatchSide,
  PhaseType,
  PRE_START_STATUSES,
  PHASE_TYPES,
  TournamentFormat,
  TournamentSettings,
  TournamentStatus,
} from './tournament.constants';
import {
  BracketSeed,
  cardPoints,
  computeStandings,
  DrawnTeam,
  formatPreview,
  GroupTable,
  groupName,
  normalizeSettings,
  orderForRest,
  qualify,
  QualificationOutput,
  randomDraw,
  ResultLine,
  Rng,
  roundName,
  roundRobin,
  seedBracket,
  seededDraw,
  shuffle,
  StandingRow,
  suggestSetups,
  TieResolution,
  validateBracketOrder,
  validatePartition,
  validateSettings,
} from './tournament-engine';
import { tournamentError } from './tournaments.errors';
import { SetFormatDto } from './dto/set-format.dto';
import { LeagueDrawDto } from './dto/league-draw.dto';
import { MatchResultDto } from './dto/match-result.dto';
import { ResolveTieDto } from './dto/resolve-tie.dto';
import { KnockoutBracketDto } from './dto/knockout-bracket.dto';
import { UpdateTournamentStatusDto } from './dto/update-tournament-status.dto';

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));
const str = (id: Types.ObjectId | null | undefined) =>
  id == null ? null : id.toString();
const sideField = (side: MatchSide) =>
  side === 'HOME' ? 'homeTeamId' : 'awayTeamId';
const otherSide = (side: MatchSide): MatchSide =>
  side === 'HOME' ? 'AWAY' : 'HOME';

/** Which statuses each organizer-set status may be reached from. */
const STATUS_TRANSITIONS: Record<string, TournamentStatus[]> = {
  DRAFT: ['REGISTRATION_OPEN'],
  REGISTRATION_OPEN: ['DRAFT', 'REGISTRATION_CLOSED'],
  REGISTRATION_CLOSED: ['REGISTRATION_OPEN'],
  CANCELLED: [
    'DRAFT',
    'REGISTRATION_OPEN',
    'REGISTRATION_CLOSED',
    'LEAGUE_IN_PROGRESS',
    'QUALIFICATION_REVIEW',
    'KNOCKOUT_IN_PROGRESS',
  ],
};

type GroupState = GroupTable & { ties: string[][]; rows: StandingRow[] };

/**
 * Tournament formats and phases: format settings, group draw, fixtures,
 * results, standings, qualification and the knockout bracket. The rules live
 * in tournament-engine.ts; this service loads, checks and persists.
 *
 * Every write needs the organizer (Tournament.createdBy). Reads are open to
 * anyone who can see the tournament, like GET /tournaments/:id.
 */
@Injectable()
export class TournamentPhasesService {
  /** Randomness for draws; replaced in tests. */
  rng: Rng = Math.random;

  constructor(
    @InjectModel(Tournament.name)
    private tournamentModel: Model<TournamentDocument>,
    @InjectModel(TournamentTeam.name)
    private teamModel: Model<TournamentTeamDocument>,
    @InjectModel(TournamentPhase.name)
    private phaseModel: Model<TournamentPhaseDocument>,
    @InjectModel(LeagueGroup.name)
    private groupModel: Model<LeagueGroupDocument>,
    @InjectModel(LeagueGroupTeam.name)
    private groupTeamModel: Model<LeagueGroupTeamDocument>,
    @InjectModel(KnockoutRound.name)
    private roundModel: Model<KnockoutRoundDocument>,
    @InjectModel(TournamentMatch.name)
    private matchModel: Model<TournamentMatchDocument>,
    @InjectModel(QualificationResult.name)
    private qualificationModel: Model<QualificationResultDocument>,
  ) {}

  // -------------------------------------------------------------------------
  // Format
  // -------------------------------------------------------------------------

  async setFormat(tournamentId: string, userId: string, dto: SetFormatDto) {
    const t = await this.loadOwned(tournamentId, userId);
    const settings = normalizeSettings(dto.format, dto);
    const teamCount = await this.previewTeamCount(t);
    const invalid = validateSettings(dto.format, settings, teamCount);
    if (invalid) throw tournamentError('INVALID_FORMAT_SETTINGS', invalid);

    const same = (a: unknown, b: unknown) =>
      JSON.stringify(a) === JSON.stringify(b);
    const leagueUnchanged =
      dto.format === t.format &&
      same(settings.league, t.settings?.league) &&
      settings.qualification?.qualifyPerGroup ===
        t.settings?.qualification?.qualifyPerGroup &&
      settings.qualification?.bestOfRest ===
        t.settings?.qualification?.bestOfRest;
    let drawReset = false;
    let next: TournamentStatus = t.status;

    if (PRE_START_STATUSES.includes(t.status)) {
      drawReset = await this.hasDrawOrBracket(t._id);
      await this.wipe(t._id, ['LEAGUE', 'KNOCKOUT']);
    } else if (t.status === 'LEAGUE_IN_PROGRESS') {
      await this.assertRestructurable(t._id, 'LEAGUE', dto.confirm);
      await this.wipe(t._id, ['LEAGUE', 'KNOCKOUT']);
      drawReset = true;
      next = 'REGISTRATION_CLOSED';
    } else if (t.status === 'QUALIFICATION_REVIEW' && leagueUnchanged) {
      // Only seeding and knockout settings: the league phase is done.
    } else if (t.status === 'KNOCKOUT_IN_PROGRESS' && leagueUnchanged) {
      await this.assertRestructurable(t._id, 'KNOCKOUT', dto.confirm);
      await this.wipe(t._id, ['KNOCKOUT']);
      next =
        t.format === 'KNOCKOUT'
          ? 'REGISTRATION_CLOSED'
          : 'QUALIFICATION_REVIEW';
    } else {
      throw tournamentError(
        'FORMAT_LOCKED',
        `The format can't change while the tournament is ${t.status}`,
      );
    }

    t.format = dto.format;
    t.type = dto.format.toLowerCase();
    t.settings = settings;
    t.markModified('settings');
    t.status = next;
    await t.save();
    await this.ensurePhases(t);
    if (t.status === 'QUALIFICATION_REVIEW') await this.runQualification(t);

    return {
      format: t.format,
      ...settings,
      status: t.status,
      drawReset,
      preview: formatPreview(t.format, settings, teamCount),
      suggestions: suggestSetups(teamCount),
    };
  }

  /** Creates the phase rows a format uses and drops the ones it doesn't. */
  async ensurePhases(t: TournamentDocument) {
    const wanted: PhaseType[] =
      t.format === 'LEAGUE'
        ? ['LEAGUE']
        : t.format === 'KNOCKOUT'
          ? ['KNOCKOUT']
          : ['LEAGUE', 'KNOCKOUT'];
    await this.wipe(
      t._id,
      PHASE_TYPES.filter((p) => !wanted.includes(p)),
      true,
    );
    for (const [i, type] of wanted.entries()) {
      await this.phaseModel.updateOne(
        { tournamentId: t._id, type },
        {
          $set: {
            order: i + 1,
            settings: this.phaseSettings(t.settings, type),
          },
          $setOnInsert: { status: 'PENDING' },
        },
        { upsert: true },
      );
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async setStatus(
    tournamentId: string,
    userId: string,
    dto: UpdateTournamentStatusDto,
  ) {
    const t = await this.loadOwned(tournamentId, userId);
    if (t.status === dto.status) return { status: t.status, drawReset: false };
    if (!STATUS_TRANSITIONS[dto.status]?.includes(t.status)) {
      throw tournamentError(
        'INVALID_STATUS_TRANSITION',
        `Can't move from ${t.status} to ${dto.status}`,
      );
    }
    let drawReset = false;
    if (
      t.status === 'REGISTRATION_CLOSED' &&
      dto.status === 'REGISTRATION_OPEN'
    ) {
      // New teams may join, so the draw and bracket no longer hold.
      drawReset = await this.hasDrawOrBracket(t._id);
      await this.clearDrawAndBracket(t._id);
    }
    await this.transition(t._id, t.status, dto.status);
    return { status: dto.status, drawReset };
  }

  async withdrawTeam(tournamentId: string, teamId: string, userId: string) {
    const t = await this.loadOwned(tournamentId, userId);
    if (!isValidObjectId(teamId))
      throw tournamentError('TEAM_NOT_FOUND', 'Team not found');
    const team = await this.teamModel.findOne({
      _id: oid(teamId),
      tournamentId: t._id,
    });
    if (!team) throw tournamentError('TEAM_NOT_FOUND', 'Team not found');
    if (t.status === 'COMPLETED' || t.status === 'CANCELLED') {
      throw tournamentError(
        'INVALID_STATUS_TRANSITION',
        `The tournament is ${t.status}`,
      );
    }
    if (team.status === 'WITHDRAWN') return { team, drawReset: false };

    team.status = 'WITHDRAWN';
    team.withdrawnAt = new Date();
    await team.save();
    let drawReset = false;

    if (PRE_START_STATUSES.includes(t.status)) {
      await this.tournamentModel.updateOne(
        { _id: t._id },
        { $inc: { currentTeams: -1 } },
      );
      drawReset = await this.hasDrawOrBracket(t._id);
      await this.clearDrawAndBracket(t._id);
    } else if (t.status === 'LEAGUE_IN_PROGRESS') {
      await this.withdrawFromLeague(t, team._id);
    } else if (t.status === 'QUALIFICATION_REVIEW') {
      // The next-ranked team in its group moves up.
      await this.runQualification(t);
    } else if (t.status === 'KNOCKOUT_IN_PROGRESS') {
      const pending = await this.matchModel.find({
        tournamentId: t._id,
        stage: 'KNOCKOUT',
        status: 'SCHEDULED',
        homeTeamId: { $ne: null },
        awayTeamId: { $ne: null },
        $or: [{ homeTeamId: team._id }, { awayTeamId: team._id }],
      });
      // A team still waiting for its opponent gets the walkover on placement.
      for (const m of pending) await this.maybeWalkover(t, m._id);
    }
    return { team, drawReset };
  }

  /**
   * Under half its league matches played: all its results go. Half or more:
   * the rest count as 3–0 wins for its opponents.
   */
  private async withdrawFromLeague(
    t: TournamentDocument,
    teamId: Types.ObjectId,
  ) {
    const matches = await this.matchModel.find({
      tournamentId: t._id,
      stage: 'LEAGUE',
      status: { $ne: 'VOID' },
      $or: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
    });
    const played = matches.filter((m) => m.status === 'COMPLETED').length;
    if (played * 2 < matches.length) {
      await this.matchModel.updateMany(
        { _id: { $in: matches.map((m) => m._id) } },
        { $set: { status: 'VOID' } },
      );
    } else {
      for (const m of matches.filter((x) => x.status === 'SCHEDULED')) {
        const side: MatchSide =
          String(m.homeTeamId) === String(teamId) ? 'HOME' : 'AWAY';
        Object.assign(m, this.forfeitFields(side), {
          status: 'COMPLETED',
          resultAt: new Date(),
        });
        await m.save();
      }
    }
    const groupIds = [...new Set(matches.map((m) => String(m.groupId)))];
    for (const g of groupIds) await this.refreshGroup(t, oid(g));
    await this.afterLeagueResult(t);
  }

  // -------------------------------------------------------------------------
  // League: draw, groups, fixtures, standings
  // -------------------------------------------------------------------------

  async draw(tournamentId: string, userId: string, dto: LeagueDrawDto) {
    const t = await this.loadOwned(tournamentId, userId);
    const league = t.settings?.league;
    if (!league)
      throw tournamentError(
        'INVALID_FORMAT_SETTINGS',
        'This format has no league phase',
      );
    this.assertPreStart(t);

    const teams = await this.approvedTeams(t._id);
    const ids = teams.map((x) => String(x._id));
    const { groupCount } = league;
    if (teams.length < groupCount * 2) {
      throw tournamentError(
        'NOT_ENOUGH_TEAMS',
        `${groupCount} group(s) need at least ${groupCount * 2} approved teams; there are ${teams.length}`,
      );
    }
    if (
      league.teamsPerGroup &&
      teams.length > groupCount * league.teamsPerGroup
    ) {
      throw tournamentError(
        'INVALID_FORMAT_SETTINGS',
        `${teams.length} teams don't fit ${groupCount} groups of ${league.teamsPerGroup}`,
      );
    }
    const method = dto.method ?? league.groupDraw;
    const separate = dto.separateSameClub ?? league.separateSameClub;
    const drawTeams = teams.map((x) => ({
      id: String(x._id),
      clubId: str(x.clubId),
    }));

    let groups: DrawnTeam[][];
    if (method === 'RANDOM') {
      groups = randomDraw(drawTeams, groupCount, separate, this.rng);
    } else if (method === 'SEEDED') {
      if (!dto.pots?.length)
        throw tournamentError('INVALID_REQUEST', 'SEEDED draw needs pots');
      const err =
        validatePartition('pots', dto.pots, ids) ??
        (dto.pots.some((p) => p.length > groupCount)
          ? `a pot can hold at most ${groupCount} teams (one per group)`
          : null);
      if (err) throw tournamentError('INVALID_REQUEST', err);
      groups = seededDraw(drawTeams, dto.pots, groupCount, separate, this.rng);
    } else {
      if (!dto.groups)
        throw tournamentError('INVALID_REQUEST', 'MANUAL draw needs groups');
      const err =
        (dto.groups.length !== groupCount
          ? `groups must have ${groupCount} entries`
          : null) ?? validatePartition('groups', dto.groups, ids);
      if (err) throw tournamentError('INVALID_REQUEST', err);
      groups = dto.groups.map((g) => g.map((id) => ({ id, pot: null })));
    }
    if (groups.some((g) => g.length < 2)) {
      throw tournamentError(
        'NOT_ENOUGH_TEAMS',
        'Every group needs at least 2 teams',
      );
    }

    await this.ensurePhases(t);
    await this.clearDrawAndBracket(t._id);
    const phase = (await this.phaseModel.findOne({
      tournamentId: t._id,
      type: 'LEAGUE',
    }))!;
    const created = await this.groupModel.insertMany(
      groups.map((_, i) => ({
        tournamentId: t._id,
        phaseId: phase._id,
        name: this.groupName(i, groupCount),
        order: i + 1,
      })),
    );
    await this.groupTeamModel.insertMany(
      groups.flatMap((g, i) =>
        g.map((team, k) => ({
          phaseId: phase._id,
          groupId: created[i]._id,
          teamId: oid(team.id),
          pot: team.pot,
          drawOrder: k + 1,
        })),
      ),
    );
    phase.drawnAt = new Date();
    await phase.save();
    if (t.status !== 'REGISTRATION_CLOSED')
      await this.transition(t._id, t.status, 'REGISTRATION_CLOSED');
    return this.getGroups(tournamentId);
  }

  async getGroups(tournamentId: string) {
    const t = await this.loadTournament(tournamentId);
    const phase = await this.phaseModel
      .findOne({ tournamentId: t._id, type: 'LEAGUE' })
      .lean();
    const groups = phase
      ? await this.groupModel
          .find({ phaseId: phase._id })
          .sort({ order: 1 })
          .lean()
      : [];
    const members = phase
      ? await this.groupTeamModel
          .find({ phaseId: phase._id })
          .sort({ drawOrder: 1 })
          .lean()
      : [];
    const names = await this.teamNames(t._id);
    return {
      drawn: groups.length > 0,
      groups: groups.map((g) => ({
        id: g._id,
        name: g.name,
        teams: members
          .filter((m) => String(m.groupId) === String(g._id))
          .map((m) => ({
            teamId: m.teamId,
            ...names.get(String(m.teamId)),
            pot: m.pot,
            drawOrder: m.drawOrder,
          })),
      })),
    };
  }

  async generateFixtures(tournamentId: string, userId: string) {
    const t = await this.loadOwned(tournamentId, userId);
    if (!t.settings?.league)
      throw tournamentError(
        'INVALID_FORMAT_SETTINGS',
        'This format has no league phase',
      );
    this.assertPreStart(t);
    const phase = await this.phaseModel.findOne({
      tournamentId: t._id,
      type: 'LEAGUE',
    });
    const groups = phase
      ? await this.groupModel.find({ phaseId: phase._id }).sort({ order: 1 })
      : [];
    if (!phase || !groups.length)
      throw tournamentError('DRAW_NOT_DONE', 'Run the group draw first');

    const double = t.settings.league.roundRobin === 'DOUBLE';
    const fixtures: {
      matchday: number;
      home: string;
      away: string;
      groupId: Types.ObjectId;
    }[] = [];
    for (const g of groups) {
      const members = await this.groupTeamModel
        .find({ groupId: g._id })
        .sort({ drawOrder: 1 })
        .lean();
      const ids = members.map((m) => String(m.teamId));
      fixtures.push(
        ...roundRobin(ids, double).map((f) => ({ ...f, groupId: g._id })),
      );
    }
    await this.matchModel.deleteMany({ phaseId: phase._id });
    const docs = orderForRest(fixtures).map((f, i) => ({
      tournamentId: t._id,
      phaseId: phase._id,
      stage: 'LEAGUE',
      groupId: f.groupId,
      matchday: f.matchday,
      sequence: i + 1,
      homeTeamId: oid(f.home),
      awayTeamId: oid(f.away),
    }));
    await this.matchModel.insertMany(docs);
    for (const g of groups) await this.refreshGroup(t, g._id);
    return this.listMatches(t._id, 'LEAGUE');
  }

  async getStandings(tournamentId: string, groupName?: string) {
    const t = await this.loadTournament(tournamentId);
    const phase = await this.phaseModel
      .findOne({ tournamentId: t._id, type: 'LEAGUE' })
      .lean();
    let groups = phase
      ? await this.groupModel.find({ phaseId: phase._id }).sort({ order: 1 })
      : [];
    if (groupName) {
      groups = groups.filter(
        (g) => g.name.toUpperCase() === groupName.toUpperCase(),
      );
      if (!groups.length)
        throw tournamentError('GROUP_NOT_FOUND', `No group ${groupName}`);
    }
    const names = await this.teamNames(t._id);
    const out: unknown[] = [];
    for (const g of groups) {
      const rows =
        (g.standings as StandingRow[] | null) ??
        (await this.refreshGroup(t, g._id)).rows;
      out.push({
        id: g._id,
        name: g.name,
        standings: rows.map((r) => ({ ...r, ...names.get(r.teamId) })),
      });
    }
    return { groups: out };
  }

  /** Recomputes one group's standings from its confirmed matches and caches them. */
  private async refreshGroup(
    t: TournamentDocument,
    groupId: Types.ObjectId,
  ): Promise<GroupState> {
    const state = await this.groupState(t, groupId);
    await this.groupModel.updateOne(
      { _id: groupId },
      { $set: { standings: state.rows } },
    );
    return state;
  }

  private async groupState(
    t: TournamentDocument,
    groupId: Types.ObjectId,
  ): Promise<GroupState> {
    const league = t.settings.league!;
    const group = await this.groupModel.findById(groupId).lean();
    const members = await this.groupTeamModel
      .find({ groupId })
      .sort({ drawOrder: 1 })
      .lean();
    const matches = await this.matchModel
      .find({ groupId, stage: 'LEAGUE' })
      .lean();
    const teams = await this.teamModel
      .find({ _id: { $in: members.map((m) => m.teamId) } }, { status: 1 })
      .lean();
    const withdrawn = new Set(
      teams.filter((x) => x.status === 'WITHDRAWN').map((x) => String(x._id)),
    );
    // A withdrawn team whose results were all removed leaves the table.
    const live = members
      .map((m) => String(m.teamId))
      .filter(
        (id) =>
          !withdrawn.has(id) ||
          matches.some(
            (m) =>
              m.status !== 'VOID' &&
              (String(m.homeTeamId) === id || String(m.awayTeamId) === id),
          ),
      );
    const results: ResultLine[] = matches
      .filter((m) => m.status === 'COMPLETED')
      .map((m) => ({
        home: String(m.homeTeamId),
        away: String(m.awayTeamId),
        homeGoals: m.homeGoals ?? 0,
        awayGoals: m.awayGoals ?? 0,
        homeCards: cardPoints(m.cards?.home),
        awayCards: cardPoints(m.cards?.away),
      }));
    const { rows, ties } = computeStandings(
      live,
      results,
      league.points,
      league.tiebreakers,
      this.resolutions(t),
    );
    return {
      groupId: String(groupId),
      name: group?.name ?? '',
      ranked: rows.map((r) => r.teamId).filter((id) => !withdrawn.has(id)),
      results,
      ties,
      rows,
    };
  }

  private async groupStates(t: TournamentDocument): Promise<GroupState[]> {
    const phase = await this.phaseModel
      .findOne({ tournamentId: t._id, type: 'LEAGUE' })
      .lean();
    if (!phase) return [];
    const groups = await this.groupModel
      .find({ phaseId: phase._id })
      .sort({ order: 1 })
      .lean();
    const out: GroupState[] = [];
    for (const g of groups) out.push(await this.groupState(t, g._id));
    return out;
  }

  // -------------------------------------------------------------------------
  // Phases
  // -------------------------------------------------------------------------

  async startPhase(tournamentId: string, userId: string, phaseParam: string) {
    const type = phaseParam.toUpperCase() as PhaseType;
    if (!PHASE_TYPES.includes(type)) {
      throw tournamentError(
        'INVALID_REQUEST',
        'phase must be league or knockout',
      );
    }
    const t = await this.loadOwned(tournamentId, userId);
    const phase = await this.phaseModel.findOne({ tournamentId: t._id, type });
    if (!phase)
      throw tournamentError(
        'INVALID_FORMAT_SETTINGS',
        `A ${t.format} tournament has no ${type} phase`,
      );
    if (phase.status !== 'PENDING')
      throw tournamentError(
        'PHASE_NOT_READY',
        `The ${type} phase has already started`,
      );

    if (type === 'LEAGUE') {
      if (!PRE_START_STATUSES.includes(t.status)) {
        throw tournamentError(
          'PHASE_NOT_READY',
          `Can't start the league while the tournament is ${t.status}`,
        );
      }
      if (!(await this.groupModel.exists({ phaseId: phase._id }))) {
        throw tournamentError('DRAW_NOT_DONE', 'Run the group draw first');
      }
      if (!(await this.matchModel.exists({ phaseId: phase._id }))) {
        throw tournamentError('PHASE_NOT_READY', 'Generate the fixtures first');
      }
      await this.transition(t._id, t.status, 'LEAGUE_IN_PROGRESS');
    } else {
      if (t.format === 'LEAGUE_KNOCKOUT') {
        if (t.status !== 'QUALIFICATION_REVIEW') {
          throw tournamentError(
            'PHASE_NOT_READY',
            'The league phase must finish first',
          );
        }
        const { ties } = await this.qualificationState(t);
        if (ties.length)
          throw tournamentError(
            'UNRESOLVED_TIE',
            'Resolve the open qualification ties first',
            { ties },
          );
        if (!phase.bracketConfirmedAt)
          throw tournamentError('PHASE_NOT_READY', 'Confirm the bracket first');
      } else {
        if (!PRE_START_STATUSES.includes(t.status)) {
          throw tournamentError(
            'PHASE_NOT_READY',
            `Can't start the knockout while the tournament is ${t.status}`,
          );
        }
        if (!(await this.roundModel.exists({ phaseId: phase._id }))) {
          throw tournamentError(
            'PHASE_NOT_READY',
            'Generate the bracket first',
          );
        }
        phase.bracketConfirmedAt ??= new Date();
      }
      await this.transition(t._id, t.status, 'KNOCKOUT_IN_PROGRESS');
    }
    phase.status = 'IN_PROGRESS';
    phase.settings = this.phaseSettings(t.settings, type);
    await phase.save();
    return {
      status: type === 'LEAGUE' ? 'LEAGUE_IN_PROGRESS' : 'KNOCKOUT_IN_PROGRESS',
      phase,
    };
  }

  // -------------------------------------------------------------------------
  // Results
  // -------------------------------------------------------------------------

  async saveResult(matchId: string, userId: string, dto: MatchResultDto) {
    if (!isValidObjectId(matchId))
      throw tournamentError('MATCH_NOT_FOUND', 'Match not found');
    const match = await this.matchModel.findById(matchId);
    if (!match) throw tournamentError('MATCH_NOT_FOUND', 'Match not found');
    const t = await this.loadOwned(String(match.tournamentId), userId);
    if (
      match.status === 'VOID' ||
      match.isBye ||
      !match.homeTeamId ||
      !match.awayTeamId
    ) {
      throw tournamentError(
        'MATCH_NOT_READY',
        'This match has no result to record',
      );
    }
    if (dto.forfeit && dto.penalties) {
      throw tournamentError(
        'PENALTIES_NOT_ALLOWED',
        'A forfeit has no penalties',
      );
    }
    if (!dto.forfeit && (dto.homeGoals == null || dto.awayGoals == null)) {
      throw tournamentError(
        'INVALID_REQUEST',
        'homeGoals and awayGoals are required',
      );
    }
    const score = dto.forfeit
      ? this.forfeitFields(dto.forfeit)
      : { homeGoals: dto.homeGoals!, awayGoals: dto.awayGoals!, forfeit: null };
    const cards = dto.cards
      ? {
          home: {
            yellow: dto.cards.home?.yellow ?? 0,
            red: dto.cards.home?.red ?? 0,
          },
          away: {
            yellow: dto.cards.away?.yellow ?? 0,
            red: dto.cards.away?.red ?? 0,
          },
        }
      : match.cards;

    if (match.stage === 'LEAGUE') {
      return this.saveLeagueResult(t, match, { ...score, cards }, dto);
    }
    return this.saveKnockoutResult(t, match, { ...score, cards }, dto);
  }

  private async saveLeagueResult(
    t: TournamentDocument,
    match: TournamentMatchDocument,
    fields: Record<string, unknown>,
    dto: MatchResultDto,
  ) {
    if (dto.penalties)
      throw tournamentError(
        'PENALTIES_NOT_ALLOWED',
        'League matches have no penalties; a draw is a draw',
      );
    const editable: TournamentStatus[] = [
      'LEAGUE_IN_PROGRESS',
      'QUALIFICATION_REVIEW',
    ];
    if (t.format === 'LEAGUE') editable.push('COMPLETED');
    if (!editable.includes(t.status)) {
      throw PRE_START_STATUSES.includes(t.status)
        ? tournamentError('PHASE_NOT_READY', 'The league phase has not started')
        : tournamentError(
            'RESULT_LOCKED',
            'League results are locked once the knockout phase starts',
          );
    }
    Object.assign(match, fields, {
      penHome: null,
      penAway: null,
      status: 'COMPLETED',
      resultAt: new Date(),
    });
    await match.save();
    await this.refreshGroup(t, match.groupId!);
    await this.afterLeagueResult(t);
    return match;
  }

  private async saveKnockoutResult(
    t: TournamentDocument,
    match: TournamentMatchDocument,
    fields: {
      homeGoals: number;
      awayGoals: number;
      forfeit: MatchSide | null;
      cards: unknown;
    },
    dto: MatchResultDto,
  ) {
    if (t.status !== 'KNOCKOUT_IN_PROGRESS' && t.status !== 'COMPLETED') {
      throw tournamentError(
        'PHASE_NOT_READY',
        'The knockout phase has not started',
      );
    }
    const secondLeg =
      match.leg === 1
        ? await this.matchModel.findOne({ firstLegMatchId: match._id })
        : null;
    if (secondLeg) {
      // First leg of two: a draw stands, the tie is decided in the second.
      if (dto.penalties)
        throw tournamentError(
          'PENALTIES_NOT_ALLOWED',
          'Penalties belong to the second leg',
        );
      if (secondLeg.status === 'COMPLETED') {
        throw tournamentError(
          'RESULT_LOCKED',
          'The second leg already has a result',
        );
      }
      Object.assign(match, fields, {
        status: 'COMPLETED',
        resultAt: new Date(),
      });
      await match.save();
      return match;
    }
    const firstLeg = match.firstLegMatchId
      ? await this.matchModel.findById(match.firstLegMatchId)
      : null;
    if (firstLeg && firstLeg.status !== 'COMPLETED') {
      throw tournamentError('MATCH_NOT_READY', 'Record the first leg first');
    }
    await this.assertNextUnplayed(match);

    // Leg 1 was played the other way round: its away team is this home team.
    const home = fields.homeGoals + (firstLeg?.awayGoals ?? 0);
    const away = fields.awayGoals + (firstLeg?.homeGoals ?? 0);
    let winner: MatchSide;
    if (fields.forfeit) {
      winner = otherSide(fields.forfeit);
    } else if (home !== away) {
      if (dto.penalties)
        throw tournamentError(
          'PENALTIES_NOT_ALLOWED',
          'Penalties only when the score is level',
        );
      winner = home > away ? 'HOME' : 'AWAY';
    } else {
      if (!dto.penalties || dto.penalties.home === dto.penalties.away) {
        throw tournamentError(
          'KNOCKOUT_NEEDS_WINNER',
          'A level knockout score needs penalties with a winner',
        );
      }
      winner = dto.penalties.home > dto.penalties.away ? 'HOME' : 'AWAY';
    }
    Object.assign(match, fields, {
      penHome: dto.penalties?.home ?? null,
      penAway: dto.penalties?.away ?? null,
      status: 'COMPLETED',
      resultAt: new Date(),
    });
    await this.decideTie(t, match, winner);
    return match;
  }

  /** Saves the tie's winner and moves the winner (and a semi-final loser) on. */
  private async decideTie(
    t: TournamentDocument,
    match: TournamentMatchDocument,
    winner: MatchSide,
  ) {
    const winnerId = match[sideField(winner)]!;
    const loserId = match[sideField(otherSide(winner))]!;
    match.winnerTeamId = winnerId;
    await match.save();
    if (match.winnerToMatchId)
      await this.placeTeam(
        t,
        match.winnerToMatchId,
        match.winnerToSide!,
        winnerId,
      );
    if (match.loserToMatchId)
      await this.placeTeam(
        t,
        match.loserToMatchId,
        match.loserToSide!,
        loserId,
      );
    await this.afterKnockoutResult(t);
  }

  /** A result is locked once the match the winner (or loser) went to has one. */
  private async assertNextUnplayed(match: TournamentMatchDocument) {
    const next = [match.winnerToMatchId, match.loserToMatchId].filter(
      Boolean,
    ) as Types.ObjectId[];
    if (!next.length) return;
    const played = await this.matchModel.exists({
      $or: [{ _id: { $in: next } }, { firstLegMatchId: { $in: next } }],
      status: 'COMPLETED',
      isBye: false,
    });
    if (played)
      throw tournamentError(
        'RESULT_LOCKED',
        'The next-round match already has a result',
      );
  }

  /** Puts a team into a tie; a two-legged tie gets it on the other side in leg 2. */
  private async placeTeam(
    t: TournamentDocument,
    matchId: Types.ObjectId,
    side: MatchSide,
    teamId: Types.ObjectId,
  ) {
    await this.matchModel.updateOne(
      { _id: matchId },
      { $set: { [sideField(side)]: teamId } },
    );
    await this.matchModel.updateOne(
      { firstLegMatchId: matchId },
      { $set: { [sideField(otherSide(side))]: teamId } },
    );
    await this.maybeWalkover(t, matchId);
  }

  /** A withdrawn team in a ready knockout tie loses it by walkover. */
  private async maybeWalkover(t: TournamentDocument, matchId: Types.ObjectId) {
    const m = await this.matchModel.findById(matchId);
    if (!m || m.status !== 'SCHEDULED' || !m.homeTeamId || !m.awayTeamId)
      return;
    const withdrawn = await this.teamModel
      .find(
        { _id: { $in: [m.homeTeamId, m.awayTeamId] }, status: 'WITHDRAWN' },
        { _id: 1 },
      )
      .lean();
    if (!withdrawn.length) return;
    const forfeit: MatchSide =
      String(withdrawn[0]._id) === String(m.homeTeamId) ? 'HOME' : 'AWAY';
    // A second leg, or a single match, decides the tie on its own.
    const leg2 =
      m.leg === 1
        ? await this.matchModel.findOne({ firstLegMatchId: m._id })
        : null;
    Object.assign(m, this.forfeitFields(forfeit), {
      status: 'COMPLETED',
      resultAt: new Date(),
    });
    if (!leg2) return this.decideTie(t, m, otherSide(forfeit));
    await m.save();
    Object.assign(leg2, this.forfeitFields(otherSide(forfeit)), {
      status: 'COMPLETED',
      resultAt: new Date(),
    });
    await this.decideTie(t, leg2, forfeit);
  }

  private forfeitFields(forfeit: MatchSide) {
    return {
      homeGoals: forfeit === 'HOME' ? 0 : FORFEIT_SCORE,
      awayGoals: forfeit === 'AWAY' ? 0 : FORFEIT_SCORE,
      penHome: null,
      penAway: null,
      forfeit,
    };
  }

  /** League done → mixed goes to qualification review, league-only completes. */
  private async afterLeagueResult(t: TournamentDocument) {
    const pending = await this.matchModel.exists({
      tournamentId: t._id,
      stage: 'LEAGUE',
      status: 'SCHEDULED',
    });
    if (pending) return;
    await this.phaseModel.updateOne(
      { tournamentId: t._id, type: 'LEAGUE' },
      { $set: { status: 'COMPLETED' } },
    );
    if (t.format === 'LEAGUE') {
      await this.completeLeagueOnly(t);
      return;
    }
    if (t.status === 'LEAGUE_IN_PROGRESS') {
      const moved = await this.tournamentModel.updateOne(
        { _id: t._id, status: 'LEAGUE_IN_PROGRESS' },
        { $set: { status: 'QUALIFICATION_REVIEW' } },
      );
      if (!moved.modifiedCount) return;
      t.status = 'QUALIFICATION_REVIEW';
    }
    if (t.status === 'QUALIFICATION_REVIEW') await this.runQualification(t);
  }

  /** League-only: the top three are placed unless a tie among them is open. */
  private async completeLeagueOnly(t: TournamentDocument) {
    const out = await this.leagueOnlyState(t);
    if (out.ties.length) {
      // An edited result can reopen a tie at the top after completion.
      if (t.status === 'COMPLETED') {
        await this.tournamentModel.updateOne(
          { _id: t._id, status: 'COMPLETED' },
          { $set: { status: 'LEAGUE_IN_PROGRESS', placements: [] } },
        );
        t.status = 'LEAGUE_IN_PROGRESS';
      }
      return out;
    }
    const placements = out.qualifiers
      .slice(0, 3)
      .map((q, i) => ({ place: i + 1, teamId: oid(q.teamId) }));
    await this.tournamentModel.updateOne(
      { _id: t._id, status: { $in: ['LEAGUE_IN_PROGRESS', 'COMPLETED'] } },
      { $set: { status: 'COMPLETED', placements } },
    );
    t.status = 'COMPLETED';
    return out;
  }

  private async leagueOnlyState(
    t: TournamentDocument,
  ): Promise<QualificationOutput> {
    const groups = await this.groupStates(t);
    const league = t.settings.league!;
    const smallest = Math.min(...groups.map((g) => g.ranked.length));
    return qualify({
      groups,
      qualifyPerGroup: Math.min(Math.ceil(3 / groups.length), smallest),
      bestOfRest: 0,
      seeding: 'CROSS_GROUP',
      points: league.points,
      tiebreakers: league.tiebreakers,
      resolutions: this.resolutions(t),
    });
  }

  private async afterKnockoutResult(t: TournamentDocument) {
    const phase = await this.phaseModel
      .findOne({ tournamentId: t._id, type: 'KNOCKOUT' })
      .lean();
    if (!phase) return;
    const rounds = await this.roundModel.find({ phaseId: phase._id }).lean();
    const finalRound = rounds.find((r) => r.teams === 2 && !r.isThirdPlace);
    const thirdRound = rounds.find((r) => r.isThirdPlace);
    const final =
      finalRound &&
      (await this.matchModel.findOne({ roundId: finalRound._id }).lean());
    const third =
      thirdRound &&
      (await this.matchModel.findOne({ roundId: thirdRound._id }).lean());
    if (!final?.winnerTeamId || (third && !third.winnerTeamId)) return;

    const loser = (m: {
      homeTeamId: Types.ObjectId | null;
      awayTeamId: Types.ObjectId | null;
      winnerTeamId: Types.ObjectId | null;
    }) =>
      String(m.homeTeamId) === String(m.winnerTeamId)
        ? m.awayTeamId
        : m.homeTeamId;
    const placements = [
      { place: 1, teamId: final.winnerTeamId },
      { place: 2, teamId: loser(final) },
    ];
    if (third) {
      placements.push(
        { place: 3, teamId: third.winnerTeamId! },
        { place: 4, teamId: loser(third) },
      );
    } else {
      // No third-place match: both semi-final losers share third.
      const semis = rounds.find((r) => r.teams === 4);
      const semiMatches = semis
        ? await this.matchModel
            .find({ roundId: semis._id, winnerTeamId: { $ne: null } })
            .lean()
        : [];
      for (const s of semiMatches.filter((m) => !m.isBye))
        placements.push({ place: 3, teamId: loser(s) });
    }
    await this.phaseModel.updateOne(
      { _id: phase._id },
      { $set: { status: 'COMPLETED' } },
    );
    await this.tournamentModel.updateOne(
      { _id: t._id, status: { $in: ['KNOCKOUT_IN_PROGRESS', 'COMPLETED'] } },
      { $set: { status: 'COMPLETED', placements } },
    );
    t.status = 'COMPLETED';
  }

  // -------------------------------------------------------------------------
  // Qualification
  // -------------------------------------------------------------------------

  private async qualificationState(
    t: TournamentDocument,
  ): Promise<QualificationOutput> {
    const q = t.settings.qualification!;
    const league = t.settings.league!;
    return qualify({
      groups: await this.groupStates(t),
      qualifyPerGroup: q.qualifyPerGroup,
      bestOfRest: q.bestOfRest,
      seeding: q.seeding,
      points: league.points,
      tiebreakers: league.tiebreakers,
      resolutions: this.resolutions(t),
    });
  }

  /**
   * Stores who qualified, drops any bracket built from older standings, and
   * proposes a new one when nothing is left for the organizer to decide.
   */
  private async runQualification(t: TournamentDocument) {
    const out = await this.qualificationState(t);
    const rulingFor = new Map<
      string,
      { resolvedBy: Types.ObjectId; reason: string }
    >();
    for (const r of t.tieResolutions ?? []) {
      for (const id of r.order)
        rulingFor.set(String(id), {
          resolvedBy: r.resolvedBy,
          reason: r.reason,
        });
    }
    await this.qualificationModel.deleteMany({
      tournamentId: t._id,
      teamId: { $nin: out.qualifiers.map((q) => oid(q.teamId)) },
    });
    if (out.qualifiers.length) {
      await this.qualificationModel.bulkWrite(
        out.qualifiers.map((q, i) => ({
          updateOne: {
            filter: { tournamentId: t._id, teamId: oid(q.teamId) },
            update: {
              $set: {
                fromGroupId: oid(q.groupId),
                rank: q.groupRank,
                seed: i + 1,
                seedLabel: q.seedLabel,
                tier: q.tier,
                resolvedBy: rulingFor.get(q.teamId)?.resolvedBy ?? null,
                reason: rulingFor.get(q.teamId)?.reason ?? null,
              },
            },
            upsert: true,
          },
        })),
      );
    }
    await this.clearBracket(t._id);
    if (!out.ties.length && t.settings.qualification!.seeding !== 'MANUAL') {
      await this.buildBracket(t, undefined, false);
    }
    return out;
  }

  async getQualification(tournamentId: string) {
    const t = await this.loadTournament(tournamentId);
    if (!t.settings?.league) {
      throw tournamentError(
        'INVALID_FORMAT_SETTINGS',
        'Only formats with a league phase have qualification',
      );
    }
    const league = await this.phaseModel
      .findOne({ tournamentId: t._id, type: 'LEAGUE' })
      .lean();
    const names = await this.teamNames(t._id);
    const named = (ids: string[]) =>
      ids.map((id) => ({ teamId: id, ...names.get(id) }));
    if (league?.status !== 'COMPLETED') {
      return { status: 'PENDING', qualifiers: [], ties: [], bracket: null };
    }
    const out =
      t.format === 'LEAGUE'
        ? await this.leagueOnlyState(t)
        : await this.qualificationState(t);
    const ties = out.ties.map((tie) => ({ ...tie, teams: named(tie.teamIds) }));
    if (t.format === 'LEAGUE') {
      return {
        status: ties.length ? 'TIE_UNRESOLVED' : 'COMPLETED',
        placements: t.placements,
        ties,
        bracket: null,
      };
    }
    const qualifiers = await this.qualificationModel
      .find({ tournamentId: t._id })
      .sort({ seed: 1 })
      .lean();
    const knockout = await this.phaseModel
      .findOne({ tournamentId: t._id, type: 'KNOCKOUT' })
      .lean();
    return {
      status: ties.length
        ? 'TIE_UNRESOLVED'
        : knockout?.bracketConfirmedAt
          ? 'CONFIRMED'
          : 'REVIEW',
      qualifiers: qualifiers.map((q) => ({
        ...q,
        ...names.get(String(q.teamId)),
      })),
      ties,
      bracket: await this.getBracket(tournamentId),
    };
  }

  async resolveTie(tournamentId: string, userId: string, dto: ResolveTieDto) {
    const t = await this.loadOwned(tournamentId, userId);
    const league = await this.phaseModel
      .findOne({ tournamentId: t._id, type: 'LEAGUE' })
      .lean();
    if (league?.status !== 'COMPLETED')
      throw tournamentError(
        'PHASE_NOT_READY',
        'The league phase is not finished',
      );
    const reviewing =
      t.status === 'QUALIFICATION_REVIEW' ||
      (t.format === 'LEAGUE' && t.status === 'LEAGUE_IN_PROGRESS');
    if (!reviewing)
      throw tournamentError(
        'FORMAT_LOCKED',
        `Ties can't change while the tournament is ${t.status}`,
      );

    const out =
      t.format === 'LEAGUE'
        ? await this.leagueOnlyState(t)
        : await this.qualificationState(t);
    const wanted = [...dto.order].sort().join();
    if (!out.ties.some((tie) => [...tie.teamIds].sort().join() === wanted)) {
      throw tournamentError(
        'INVALID_REQUEST',
        'order must list exactly the teams of one open tie',
        {
          ties: out.ties,
        },
      );
    }
    t.tieResolutions.push({
      order: dto.order.map(oid),
      reason: dto.reason,
      resolvedBy: oid(userId),
      resolvedAt: new Date(),
    });
    await t.save();
    if (t.format === 'LEAGUE') await this.completeLeagueOnly(t);
    else await this.runQualification(t);
    // Tied teams' cached standings now reflect the ruling.
    for (const g of await this.groupModel
      .find({ tournamentId: t._id }, { _id: 1 })
      .lean()) {
      await this.refreshGroup(t, g._id);
    }
    return this.getQualification(tournamentId);
  }

  // -------------------------------------------------------------------------
  // Knockout bracket
  // -------------------------------------------------------------------------

  async knockoutBracket(
    tournamentId: string,
    userId: string,
    dto: KnockoutBracketDto,
  ) {
    const t = await this.loadOwned(tournamentId, userId);
    if (t.format === 'LEAGUE')
      throw tournamentError(
        'INVALID_FORMAT_SETTINGS',
        'A LEAGUE tournament has no bracket',
      );
    await this.ensurePhases(t);
    const phase = (await this.phaseModel.findOne({
      tournamentId: t._id,
      type: 'KNOCKOUT',
    }))!;
    if (phase.status !== 'PENDING')
      throw tournamentError(
        'FORMAT_LOCKED',
        'The knockout phase has already started',
      );

    if (t.format === 'LEAGUE_KNOCKOUT') {
      if (t.status !== 'QUALIFICATION_REVIEW') {
        throw tournamentError(
          'PHASE_NOT_READY',
          'The bracket comes from the finished league phase',
        );
      }
      const { ties } = await this.qualificationState(t);
      if (ties.length)
        throw tournamentError(
          'UNRESOLVED_TIE',
          'Resolve the open qualification ties first',
          { ties },
        );
    } else {
      this.assertPreStart(t);
      const teams = await this.approvedTeams(t._id);
      if (teams.length < 2)
        throw tournamentError(
          'NOT_ENOUGH_TEAMS',
          'A knockout needs at least 2 approved teams',
        );
    }

    const exists = await this.roundModel.exists({ phaseId: phase._id });
    if (dto.confirm && exists && !dto.order) {
      phase.bracketConfirmedAt = new Date();
      await phase.save();
    } else {
      await this.buildBracket(t, dto.order, !!dto.confirm);
    }
    if (t.format === 'KNOCKOUT' && t.status !== 'REGISTRATION_CLOSED') {
      await this.transition(t._id, t.status, 'REGISTRATION_CLOSED');
    }
    return this.getBracket(tournamentId);
  }

  /** Lays out round one (from seeds, a draw or `order`) and creates every round. */
  private async buildBracket(
    t: TournamentDocument,
    order: (string | null)[] | undefined,
    confirm: boolean,
  ) {
    const phase = (await this.phaseModel.findOne({
      tournamentId: t._id,
      type: 'KNOCKOUT',
    }))!;
    let seeds: BracketSeed[];
    let seeding: string;
    const labels = new Map<string, string>();
    if (t.format === 'LEAGUE_KNOCKOUT') {
      const qualifiers = await this.qualificationModel
        .find({ tournamentId: t._id })
        .sort({ seed: 1 })
        .lean();
      seeds = qualifiers.map((q) => ({
        teamId: String(q.teamId),
        groupId: String(q.fromGroupId),
        tier: q.tier,
      }));
      for (const q of qualifiers) labels.set(String(q.teamId), q.seedLabel);
      seeding = t.settings.qualification!.seeding;
    } else {
      const teams = await this.approvedTeams(t._id);
      seeds = teams.map((x) => ({
        teamId: String(x._id),
        groupId: null,
        tier: 0,
      }));
      seeding = t.settings.knockout!.bracketSeeding;
    }

    let slots: (string | null)[];
    let clashes: number[] = [];
    if (order) {
      const err = validateBracketOrder(
        order,
        seeds.map((s) => s.teamId),
      );
      if (err) throw tournamentError('INVALID_REQUEST', err);
      slots = order;
    } else if (seeding === 'MANUAL') {
      throw tournamentError('INVALID_REQUEST', 'MANUAL seeding needs an order');
    } else if (seeding === 'RANDOM_DRAW') {
      // Byes fall to whoever is drawn into the top seed positions.
      slots = seedBracket(shuffle(seeds, this.rng), false).slots;
    } else {
      ({ slots, clashes } = seedBracket(seeds, seeding === 'CROSS_GROUP'));
    }
    await this.clearBracket(t._id);
    await this.persistBracket(t, phase, slots, labels);
    phase.bracketClashes = clashes;
    phase.bracketConfirmedAt = confirm ? new Date() : null;
    await phase.save();
  }

  private async persistBracket(
    t: TournamentDocument,
    phase: TournamentPhaseDocument,
    slots: (string | null)[],
    labels: Map<string, string>,
  ) {
    const knockout = t.settings.knockout!;
    const size = slots.length;
    const roundCount = Math.log2(size);
    const withThird = knockout.thirdPlaceMatch && size >= 4;
    const rounds = Array.from({ length: roundCount }, (_, r) => ({
      _id: new Types.ObjectId(),
      tournamentId: t._id,
      phaseId: phase._id,
      name: roundName(size / 2 ** r),
      order: r + 1,
      teams: size / 2 ** r,
      isThirdPlace: false,
    }));
    const thirdRound = withThird
      ? {
          _id: new Types.ObjectId(),
          tournamentId: t._id,
          phaseId: phase._id,
          name: 'Third place',
          order: roundCount + 1,
          teams: 2,
          isThirdPlace: true,
        }
      : null;
    const tieIds = rounds.map((r) =>
      Array.from({ length: r.teams / 2 }, () => new Types.ObjectId()),
    );
    const thirdId = new Types.ObjectId();

    const docs: Record<string, any>[] = [];
    const byId = new Map<string, Record<string, any>>();
    let sequence = 0;
    const base = { tournamentId: t._id, phaseId: phase._id, stage: 'KNOCKOUT' };
    rounds.forEach((round, r) => {
      const isFinal = r === roundCount - 1;
      const secondLegs: Record<string, any>[] = [];
      tieIds[r].forEach((id, s) => {
        let home = r === 0 ? slots[2 * s] : null;
        let away = r === 0 ? slots[2 * s + 1] : null;
        if (r === 0 && home === null) [home, away] = [away, null];
        const isBye = r === 0 && away === null;
        const routing = {
          winnerToMatchId: isFinal ? null : tieIds[r + 1][Math.floor(s / 2)],
          winnerToSide: isFinal ? null : s % 2 === 0 ? 'HOME' : 'AWAY',
          loserToMatchId: withThird && r === roundCount - 2 ? thirdId : null,
          loserToSide:
            withThird && r === roundCount - 2
              ? s % 2 === 0
                ? 'HOME'
                : 'AWAY'
              : null,
        };
        const twoLegs = knockout.legs === 2 && !isFinal && !isBye;
        const leg1 = {
          ...base,
          _id: id,
          roundId: round._id,
          slot: s + 1,
          leg: 1,
          sequence: ++sequence,
          homeTeamId: home ? oid(home) : null,
          awayTeamId: away ? oid(away) : null,
          homeSeed: home ? (labels.get(home) ?? null) : null,
          awaySeed: away ? (labels.get(away) ?? null) : null,
          isBye,
          status: isBye ? 'COMPLETED' : 'SCHEDULED',
          winnerTeamId: isBye ? oid(home!) : null,
          ...(twoLegs ? {} : routing),
        };
        docs.push(leg1);
        byId.set(String(id), leg1);
        if (twoLegs) {
          secondLegs.push({
            ...base,
            _id: new Types.ObjectId(),
            roundId: round._id,
            slot: s + 1,
            leg: 2,
            firstLegMatchId: id,
            homeTeamId: leg1.awayTeamId,
            awayTeamId: leg1.homeTeamId,
            homeSeed: leg1.awaySeed,
            awaySeed: leg1.homeSeed,
            ...routing,
          });
        }
      });
      for (const leg2 of secondLegs)
        docs.push({ ...leg2, sequence: ++sequence });
    });
    if (thirdRound) {
      docs.push({
        ...base,
        _id: thirdId,
        roundId: thirdRound._id,
        slot: 1,
        leg: 1,
        sequence: ++sequence,
      });
    }
    // Byes go straight into round two.
    for (const d of docs.filter((x) => x.isBye)) {
      const next = byId.get(String(d.winnerToMatchId));
      if (!next) continue;
      next[sideField(d.winnerToSide as MatchSide)] =
        d.winnerTeamId as Types.ObjectId;
      next[d.winnerToSide === 'HOME' ? 'homeSeed' : 'awaySeed'] = d.homeSeed as
        | string
        | null;
      const nextLeg2 = docs.find(
        (x) => String(x.firstLegMatchId) === String(next._id),
      );
      if (nextLeg2)
        nextLeg2[sideField(otherSide(d.winnerToSide as MatchSide))] =
          d.winnerTeamId as Types.ObjectId;
    }
    await this.roundModel.insertMany(
      thirdRound ? [...rounds, thirdRound] : rounds,
    );
    await this.matchModel.insertMany(docs);
  }

  async getBracket(tournamentId: string) {
    const t = await this.loadTournament(tournamentId);
    const phase = await this.phaseModel
      .findOne({ tournamentId: t._id, type: 'KNOCKOUT' })
      .lean();
    if (!phase)
      return { confirmed: false, clashes: [], rounds: [], thirdPlace: null };
    const rounds = await this.roundModel
      .find({ phaseId: phase._id })
      .sort({ order: 1 })
      .lean();
    const matches = await this.matchModel
      .find({ phaseId: phase._id })
      .sort({ slot: 1 })
      .lean();
    const names = await this.teamNames(t._id);

    const team = (id: Types.ObjectId | null, seed: string | null) =>
      id ? { teamId: id, ...names.get(id.toString()), seed } : null;
    const score = (m: (typeof matches)[number]) =>
      m.status === 'COMPLETED' && !m.isBye
        ? {
            home: m.homeGoals,
            away: m.awayGoals,
            ...(m.penHome != null
              ? { penalties: { home: m.penHome, away: m.penAway } }
              : {}),
            ...(m.forfeit ? { forfeit: m.forfeit } : {}),
          }
        : null;
    const present = (m: (typeof matches)[number]) => {
      const leg2 = matches.find(
        (x) => String(x.firstLegMatchId) === String(m._id),
      );
      const decider = leg2 ?? m;
      const entry: Record<string, unknown> = {
        id: m._id,
        slot: m.slot,
        home: team(m.homeTeamId, m.homeSeed),
        away: m.isBye ? { bye: true } : team(m.awayTeamId, m.awaySeed),
        score: score(m),
        status: leg2 ? leg2.status : m.status,
        winnerTeamId: decider.winnerTeamId,
        winnerTo: decider.winnerToMatchId
          ? `${decider.winnerToMatchId.toString()}.${decider.winnerToSide!.toLowerCase()}`
          : null,
      };
      if (leg2) {
        // Aggregate from leg 1's home team's side.
        const done = m.status === 'COMPLETED' && leg2.status === 'COMPLETED';
        entry.score = done
          ? {
              home: (m.homeGoals ?? 0) + (leg2.awayGoals ?? 0),
              away: (m.awayGoals ?? 0) + (leg2.homeGoals ?? 0),
              ...(leg2.penHome != null
                ? { penalties: { home: leg2.penAway, away: leg2.penHome } }
                : {}),
            }
          : null;
        entry.legs = [
          { id: m._id, leg: 1, score: score(m), status: m.status },
          { id: leg2._id, leg: 2, score: score(leg2), status: leg2.status },
        ];
      }
      return entry;
    };
    const firstLegsOf = (roundId: unknown) =>
      matches.filter(
        (m) => String(m.roundId) === String(roundId) && m.leg === 1,
      );
    const third = rounds.find((r) => r.isThirdPlace);
    return {
      confirmed: !!phase.bracketConfirmedAt,
      clashes: phase.bracketClashes ?? [],
      rounds: rounds
        .filter((r) => !r.isThirdPlace)
        .map((r) => ({
          id: r._id,
          name: r.name,
          matches: firstLegsOf(r._id).map(present),
        })),
      thirdPlace: third
        ? (firstLegsOf(third._id).map(present)[0] ?? null)
        : null,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  async loadTournament(id: string): Promise<TournamentDocument> {
    if (!isValidObjectId(id))
      throw tournamentError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
    const t = await this.tournamentModel.findById(id);
    if (!t)
      throw tournamentError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
    if (!t.settings || !Object.keys(t.settings).length) {
      // Tournaments created before formats existed.
      t.settings = normalizeSettings(t.format ?? 'KNOCKOUT');
    }
    return t;
  }

  private async loadOwned(id: string, userId: string) {
    const t = await this.loadTournament(id);
    if (String(t.createdBy) !== userId) {
      throw tournamentError(
        'NOT_ORGANIZER',
        'Only the tournament organizer can do this',
      );
    }
    return t;
  }

  private assertPreStart(t: TournamentDocument) {
    if (!PRE_START_STATUSES.includes(t.status)) {
      throw tournamentError(
        'FORMAT_LOCKED',
        `The draw can't change while the tournament is ${t.status}`,
      );
    }
  }

  /** Structure may change after a phase starts only with confirm and no results yet. */
  private async assertRestructurable(
    tournamentId: Types.ObjectId,
    stage: PhaseType,
    confirm?: boolean,
  ) {
    const played = await this.matchModel.exists({
      tournamentId,
      stage,
      status: 'COMPLETED',
      isBye: false,
    });
    if (played)
      throw tournamentError(
        'FORMAT_LOCKED',
        `The ${stage} phase already has results`,
      );
    if (!confirm) {
      throw tournamentError(
        'FORMAT_LOCKED',
        `The ${stage} phase has started; resend with confirm: true to rebuild it`,
      );
    }
  }

  private async transition(
    id: Types.ObjectId,
    from: TournamentStatus,
    to: TournamentStatus,
  ) {
    const res = await this.tournamentModel.updateOne(
      { _id: id, status: from },
      { $set: { status: to } },
    );
    if (!res.modifiedCount) {
      throw tournamentError(
        'INVALID_STATUS_TRANSITION',
        'The tournament changed meanwhile; reload and retry',
      );
    }
  }

  private approvedTeams(tournamentId: Types.ObjectId) {
    return this.teamModel
      .find({ tournamentId, ...APPROVED_REGISTRATION })
      .sort({ createdAt: 1 })
      .lean();
  }

  /** Approved teams once there are enough to matter, else the planned maximum. */
  private async previewTeamCount(t: TournamentDocument) {
    const approved = await this.teamModel.countDocuments({
      tournamentId: t._id,
      ...APPROVED_REGISTRATION,
    });
    return approved >= 2 ? approved : t.maxTeams;
  }

  private async teamNames(tournamentId: Types.ObjectId) {
    const teams = await this.teamModel
      .find({ tournamentId }, { name: 1, status: 1 })
      .lean();
    return new Map(
      teams.map((x) => [
        String(x._id),
        { name: x.name, withdrawn: x.status === 'WITHDRAWN' },
      ]),
    );
  }

  private resolutions(t: TournamentDocument): TieResolution[] {
    return (t.tieResolutions ?? []).map((r) => ({
      order: r.order.map(String),
    }));
  }

  private groupName(index: number, groupCount: number) {
    return groupCount === 1 ? 'League' : groupName(index);
  }

  private phaseSettings(s: TournamentSettings, type: PhaseType) {
    return type === 'LEAGUE'
      ? {
          league: s.league,
          ...(s.qualification ? { qualification: s.qualification } : {}),
        }
      : { knockout: s.knockout };
  }

  private async hasDrawOrBracket(tournamentId: Types.ObjectId) {
    return !!(
      (await this.groupModel.exists({ tournamentId })) ||
      (await this.roundModel.exists({ tournamentId }))
    );
  }

  private async clearBracket(tournamentId: Types.ObjectId) {
    await this.roundModel.deleteMany({ tournamentId });
    await this.matchModel.deleteMany({ tournamentId, stage: 'KNOCKOUT' });
    await this.phaseModel.updateOne(
      { tournamentId, type: 'KNOCKOUT' },
      { $set: { bracketConfirmedAt: null, bracketClashes: [] } },
    );
  }

  private async clearDrawAndBracket(tournamentId: Types.ObjectId) {
    const phases = await this.phaseModel
      .find({ tournamentId }, { _id: 1 })
      .lean();
    await this.groupModel.deleteMany({ tournamentId });
    await this.groupTeamModel.deleteMany({
      phaseId: { $in: phases.map((p) => p._id) },
    });
    await this.matchModel.deleteMany({ tournamentId });
    await this.roundModel.deleteMany({ tournamentId });
    await this.qualificationModel.deleteMany({ tournamentId });
    await this.phaseModel.updateMany(
      { tournamentId },
      {
        $set: {
          drawnAt: null,
          bracketConfirmedAt: null,
          bracketClashes: [],
          status: 'PENDING',
        },
      },
    );
  }

  /** Removes everything a phase built; `dropPhase` also removes the phase row. */
  private async wipe(
    tournamentId: Types.ObjectId,
    types: PhaseType[],
    dropPhase = false,
  ) {
    const phases = await this.phaseModel
      .find({ tournamentId, type: { $in: types } }, { _id: 1, type: 1 })
      .lean();
    if (!phases.length) return;
    const ids = phases.map((p) => p._id);
    await this.groupModel.deleteMany({ phaseId: { $in: ids } });
    await this.groupTeamModel.deleteMany({ phaseId: { $in: ids } });
    await this.roundModel.deleteMany({ phaseId: { $in: ids } });
    await this.matchModel.deleteMany({ phaseId: { $in: ids } });
    if (types.includes('LEAGUE'))
      await this.qualificationModel.deleteMany({ tournamentId });
    if (dropPhase) {
      await this.phaseModel.deleteMany({ _id: { $in: ids } });
    } else {
      await this.phaseModel.updateMany(
        { _id: { $in: ids } },
        {
          $set: {
            status: 'PENDING',
            drawnAt: null,
            bracketConfirmedAt: null,
            bracketClashes: [],
          },
        },
      );
    }
  }

  async listMatches(tournamentId: Types.ObjectId, stage?: PhaseType) {
    return this.matchModel
      .find({ tournamentId, ...(stage ? { stage } : {}) })
      .sort({ stage: -1, sequence: 1 })
      .lean();
  }

  /** Used by TournamentsService when a tournament is created. */
  async initFormat(t: TournamentDocument, format: TournamentFormat) {
    t.format = format;
    t.type = format.toLowerCase();
    t.settings = normalizeSettings(format);
    t.markModified('settings');
    await t.save();
    await this.ensurePhases(t);
  }
}
