import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Tournament, TournamentDocument } from './schemas/tournament.schema';
import { TournamentTeam, TournamentTeamDocument } from './schemas/tournament-team.schema';
import { TournamentMatch, TournamentMatchDocument } from './schemas/tournament-match.schema';
import { GroupMember, GroupMemberDocument } from '../groups/schemas/group-member.schema';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { RegisterTeamDto } from './dto/register-team.dto';
import { UpdateMatchDto } from './dto/update-match.dto';

@Injectable()
export class TournamentsService {
  constructor(
    @InjectModel(Tournament.name) private tournamentModel: Model<TournamentDocument>,
    @InjectModel(TournamentTeam.name) private teamModel: Model<TournamentTeamDocument>,
    @InjectModel(TournamentMatch.name) private matchModel: Model<TournamentMatchDocument>,
    @InjectModel(GroupMember.name) private memberModel: Model<GroupMemberDocument>,
  ) {}

  async create(userId: string, dto: CreateTournamentDto): Promise<TournamentDocument> {
    if (dto.groupId) {
      const member = await this.memberModel.findOne({
        groupId: new Types.ObjectId(dto.groupId),
        userId: new Types.ObjectId(userId),
        status: 'approved',
        role: { $in: ['owner', 'admin'] },
      });
      if (!member) throw new ForbiddenException('Only group owner or admin can create tournaments');
    }
    return this.tournamentModel.create({
      ...dto,
      startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      groupId: dto.groupId ? new Types.ObjectId(dto.groupId) : null,
      createdBy: new Types.ObjectId(userId),
    });
  }

  async findById(tournamentId: string) {
    const tournament = await this.tournamentModel.findById(tournamentId).lean();
    if (!tournament) throw new NotFoundException('Tournament not found');
    const teams = await this.teamModel.find({ tournamentId: new Types.ObjectId(tournamentId) }).lean();
    const matches = await this.matchModel.find({ tournamentId: new Types.ObjectId(tournamentId) }).lean();
    return { tournament, teams, matches };
  }

  async registerTeam(tournamentId: string, userId: string, dto: RegisterTeamDto) {
    // Atomic: only increment if status='registering' and currentTeams < maxTeams
    const updated = await this.tournamentModel.findOneAndUpdate(
      {
        _id: tournamentId,
        status: 'registering',
        $expr: { $lt: ['$currentTeams', '$maxTeams'] },
      },
      { $inc: { currentTeams: 1 } },
      { new: false }, // return old doc to check
    );
    if (!updated) {
      const t = await this.tournamentModel.findById(tournamentId).lean();
      if (!t) throw new NotFoundException('Tournament not found');
      throw new BadRequestException(
        t.status !== 'registering' ? 'Tournament is not accepting registrations' : 'Tournament is full',
      );
    }

    const team = await this.teamModel.create({
      tournamentId: new Types.ObjectId(tournamentId),
      name: dto.name,
      players: dto.players.map((id) => new Types.ObjectId(id)),
      captainId: dto.captainId ? new Types.ObjectId(dto.captainId) : new Types.ObjectId(userId),
    });

    return team;
  }

  async updateMatch(tournamentId: string, matchId: string, userId: string, dto: UpdateMatchDto) {
    const tournament = await this.tournamentModel.findById(tournamentId);
    if (!tournament) throw new NotFoundException('Tournament not found');
    if (tournament.createdBy.toString() !== userId) {
      throw new ForbiddenException('Only tournament creator can update match scores');
    }

    return this.matchModel.findOneAndUpdate(
      {
        _id: matchId,
        tournamentId: new Types.ObjectId(tournamentId),
      },
      {
        $set: {
          scoreA: dto.scoreA,
          scoreB: dto.scoreB,
          winnerId: dto.winnerId ? new Types.ObjectId(dto.winnerId) : null,
          status: 'completed',
        },
      },
      { new: true },
    );
  }
}
