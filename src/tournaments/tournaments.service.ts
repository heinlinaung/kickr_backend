import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { randomInt } from 'crypto';
import { Model, Types } from 'mongoose';
import { Tournament, TournamentDocument } from './schemas/tournament.schema';
import {
  TournamentTeam,
  TournamentTeamDocument,
} from './schemas/tournament-team.schema';
import {
  TournamentMatch,
  TournamentMatchDocument,
} from './schemas/tournament-match.schema';
import {
  GroupMember,
  GroupMemberDocument,
} from '../groups/schemas/group-member.schema';
import { Group, GroupDocument } from '../groups/schemas/group.schema';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { RegisterTeamDto } from './dto/register-team.dto';
import { TournamentPhasesService } from './tournament-phases.service';
import { TOURNAMENT_STATUSES, TournamentFormat } from './tournament.constants';
import type { TournamentStatus } from './tournament.constants';
import { JoinTournamentByCodeDto } from './dto/join-by-code.dto';
import { tournamentError } from './tournaments.errors';
import { tournamentDeepLink } from '../common/deep-links';

/** No 0/O, 1/I/L: the code is also read off a poster and typed in. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

@Injectable()
export class TournamentsService {
  constructor(
    @InjectModel(Tournament.name)
    private tournamentModel: Model<TournamentDocument>,
    @InjectModel(TournamentTeam.name)
    private teamModel: Model<TournamentTeamDocument>,
    @InjectModel(TournamentMatch.name)
    private matchModel: Model<TournamentMatchDocument>,
    @InjectModel(GroupMember.name)
    private memberModel: Model<GroupMemberDocument>,
    @InjectModel(Group.name)
    private groupModel: Model<GroupDocument>,
    private phasesService: TournamentPhasesService,
    private config: ConfigService,
  ) {}

  async create(
    userId: string,
    dto: CreateTournamentDto,
  ): Promise<TournamentDocument> {
    if (dto.groupId) {
      const member = await this.memberModel.findOne({
        groupId: new Types.ObjectId(dto.groupId),
        userId: new Types.ObjectId(userId),
        status: 'approved',
        role: { $in: ['owner', 'admin'] },
      });
      if (!member)
        throw new ForbiddenException(
          'Only group owner or admin can create tournaments',
        );
    }
    const { format, type, ...rest } = dto;
    const tournament = await this.tournamentModel.create({
      ...rest,
      startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      groupId: dto.groupId ? new Types.ObjectId(dto.groupId) : null,
      createdBy: new Types.ObjectId(userId),
    });
    // `type` is the pre-format field; LEAGUE / KNOCKOUT map one to one.
    const chosen =
      format ?? ((type?.toUpperCase() ?? 'KNOCKOUT') as TournamentFormat);
    await this.phasesService.initFormat(tournament, chosen);
    return tournament;
  }

  async findById(tournamentId: string) {
    const tournament = await this.tournamentModel.findById(tournamentId).lean();
    if (!tournament) throw new NotFoundException('Tournament not found');
    const teams = await this.teamModel
      .find({ tournamentId: new Types.ObjectId(tournamentId) })
      .lean();
    const matches = await this.matchModel
      .find({ tournamentId: new Types.ObjectId(tournamentId) })
      .lean();
    return { tournament, teams, matches };
  }

  /**
   * A group's tournaments, newest first, for the group detail screen.
   * Same gate as the group's events: a private group's tournaments are only
   * visible to approved members (403 otherwise, so the client can show a
   * join prompt instead of an empty list).
   */
  async listByGroup(groupId: string, userId: string, status?: string) {
    if (!Types.ObjectId.isValid(groupId)) {
      throw new BadRequestException('Invalid group id');
    }

    const group = await this.groupModel
      .findById(groupId)
      .select('_id isPrivate')
      .lean();
    if (!group) throw new NotFoundException('Group not found');

    if (group.isPrivate) {
      const member = await this.memberModel.exists({
        groupId: new Types.ObjectId(groupId),
        userId: new Types.ObjectId(userId),
        status: 'approved',
      });
      if (!member) {
        throw new ForbiddenException(
          'This group is private — join it to see its tournaments',
        );
      }
    }

    const filter: Record<string, unknown> = {
      groupId: new Types.ObjectId(groupId),
    };
    if (status !== undefined) {
      if (!TOURNAMENT_STATUSES.includes(status as TournamentStatus)) {
        throw new BadRequestException(`Unknown status '${status}'`);
      }
      filter.status = status;
    }

    return this.tournamentModel.find(filter).sort({ createdAt: -1 }).lean();
  }

  async registerTeam(
    tournamentId: string,
    userId: string,
    dto: RegisterTeamDto,
  ) {
    // Atomic: only increment if status='registering' and currentTeams < maxTeams
    const updated = await this.tournamentModel.findOneAndUpdate(
      {
        _id: tournamentId,
        status: 'REGISTRATION_OPEN',
        $expr: { $lt: ['$currentTeams', '$maxTeams'] },
      },
      { $inc: { currentTeams: 1 } },
      { new: false }, // return old doc to check
    );
    if (!updated) {
      const t = await this.tournamentModel.findById(tournamentId).lean();
      if (!t) throw new NotFoundException('Tournament not found');
      throw new BadRequestException(
        t.status !== 'REGISTRATION_OPEN'
          ? 'Tournament is not accepting registrations'
          : 'Tournament is full',
      );
    }

    // Check for duplicate captainId (same user can't register twice)
    const duplicateTeam = await this.teamModel.findOne({
      tournamentId: new Types.ObjectId(tournamentId),
      captainId: dto.captainId
        ? new Types.ObjectId(dto.captainId)
        : new Types.ObjectId(userId),
    });
    if (duplicateTeam) {
      // Roll back the slot increment
      await this.tournamentModel.findByIdAndUpdate(tournamentId, {
        $inc: { currentTeams: -1 },
      });
      throw new ConflictException(
        'You have already registered a team in this tournament',
      );
    }

    const team = await this.teamModel.create({
      tournamentId: new Types.ObjectId(tournamentId),
      name: dto.name,
      players: dto.players.map((id) => new Types.ObjectId(id)),
      captainId: dto.captainId
        ? new Types.ObjectId(dto.captainId)
        : new Types.ObjectId(userId),
      clubId: dto.clubId ? new Types.ObjectId(dto.clubId) : null,
    });

    return team;
  }

  /**
   * The tournament's QR / share link. Any authenticated user may fetch it:
   * the code only leads to `POST /tournaments/:id/teams`, which is already
   * open to everyone, so it is not a secret. The code is minted once and then
   * reused, so a shared or printed QR keeps working.
   */
  async getQr(tournamentId: string): Promise<{
    inviteCode: string;
    inviteLink: string;
    deepLink: string;
    tournamentId: string;
  }> {
    const t = Types.ObjectId.isValid(tournamentId)
      ? await this.tournamentModel
          .findById(tournamentId)
          .select('inviteCode')
          .lean()
      : null;
    if (!t) {
      throw tournamentError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
    }
    const code = t.inviteCode ?? (await this.mintInviteCode(t._id));

    const base = this.config.get<string>('APP_BASE_URL') ?? '';
    return {
      inviteCode: code,
      // What the QR encodes: https works from any camera, app or not, and
      // GET /t/:code hops into the app from there.
      inviteLink: `${base}/t/${code}`,
      deepLink: tournamentDeepLink(tournamentId),
      tournamentId,
    };
  }

  /**
   * The tournament a QR / share code points at, with the card fields a
   * stranger may see (`GET /t/:code` is public), or `null` for an unknown code.
   */
  async resolveInviteCode(code: string) {
    const normalized = normalizeCode(code);
    if (!normalized) return null;
    const t = await this.tournamentModel
      .findOne({ inviteCode: normalized })
      .select('title format status startDate maxTeams currentTeams groupId')
      .lean();
    if (!t) return null;
    const host = t.groupId
      ? await this.groupModel.findById(t.groupId).select('name logo').lean()
      : null;
    return {
      _id: t._id,
      title: t.title,
      format: t.format,
      status: t.status,
      startDate: t.startDate ?? null,
      maxTeams: t.maxTeams,
      currentTeams: t.currentTeams,
      registrationOpen:
        t.status === 'REGISTRATION_OPEN' && t.currentTeams < t.maxTeams,
      hostGroup: host
        ? { _id: host._id, name: host.name, logo: host.logo ?? null }
        : null,
    };
  }

  /**
   * `POST /tournaments/join-by-code`: registers the caller's team in the
   * tournament behind a scanned QR or opened link, exactly like
   * `POST /tournaments/:id/teams`.
   */
  async joinByCode(userId: string, dto: JoinTournamentByCodeDto) {
    const { code, ...team } = dto;
    const normalized = normalizeCode(code);
    const t = normalized
      ? await this.tournamentModel
          .findOne({ inviteCode: normalized })
          .select('_id')
          .lean()
      : null;
    if (!t) {
      throw tournamentError(
        'INVALID_INVITE_CODE',
        'This tournament link is not valid',
      );
    }
    return this.registerTeam(t._id.toString(), userId, team);
  }

  /**
   * Sets a fresh code unless one is already there (a concurrent first fetch
   * may have won; its code is the one kept). Retries on the rare collision
   * with another tournament's code.
   */
  private async mintInviteCode(id: Types.ObjectId): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = Array.from(
        { length: CODE_LENGTH },
        () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
      ).join('');
      try {
        const updated = await this.tournamentModel.findOneAndUpdate(
          { _id: id, inviteCode: { $exists: false } },
          { $set: { inviteCode: code } },
          { new: true, projection: { inviteCode: 1 } },
        );
        if (updated?.inviteCode) return updated.inviteCode;
        const current = await this.tournamentModel
          .findById(id)
          .select('inviteCode')
          .lean();
        if (current?.inviteCode) return current.inviteCode;
        throw tournamentError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
      } catch (err) {
        if ((err as { code?: number })?.code !== 11000) throw err;
      }
    }
    throw new Error('Could not mint a unique tournament invite code');
  }
}

/** Codes are stored upper-case; people type them however. */
function normalizeCode(code: string | undefined): string | null {
  const c = (code ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{4,32}$/.test(c) ? c : null;
}
