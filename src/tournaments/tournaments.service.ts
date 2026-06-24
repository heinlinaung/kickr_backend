import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Tournament, TournamentDocument } from './schemas/tournament.schema';
import { TournamentTeam, TournamentTeamDocument } from './schemas/tournament-team.schema';
import { TournamentMatch, TournamentMatchDocument } from './schemas/tournament-match.schema';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { RegisterTeamDto } from './dto/register-team.dto';
import { UpdateMatchDto } from './dto/update-match.dto';

@Injectable()
export class TournamentsService {
  constructor(
    @InjectModel(Tournament.name) private tournamentModel: Model<TournamentDocument>,
    @InjectModel(TournamentTeam.name) private teamModel: Model<TournamentTeamDocument>,
    @InjectModel(TournamentMatch.name) private matchModel: Model<TournamentMatchDocument>,
  ) {}

  async create(userId: string, dto: CreateTournamentDto): Promise<TournamentDocument> {
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
    const tournament = await this.tournamentModel.findById(tournamentId);
    if (!tournament) throw new NotFoundException('Tournament not found');
    if (tournament.status !== 'registering') throw new BadRequestException('Tournament is not accepting registrations');
    if (tournament.currentTeams >= tournament.maxTeams) throw new BadRequestException('Tournament is full');

    const team = await this.teamModel.create({
      tournamentId: new Types.ObjectId(tournamentId),
      name: dto.name,
      players: dto.players.map((id) => new Types.ObjectId(id)),
      captainId: dto.captainId ? new Types.ObjectId(dto.captainId) : new Types.ObjectId(userId),
    });

    await this.tournamentModel.findByIdAndUpdate(tournamentId, { $inc: { currentTeams: 1 } });
    return team;
  }

  async updateMatch(tournamentId: string, matchId: string, userId: string, dto: UpdateMatchDto) {
    const tournament = await this.tournamentModel.findById(tournamentId);
    if (!tournament) throw new NotFoundException('Tournament not found');
    if (tournament.createdBy.toString() !== userId) {
      throw new ForbiddenException('Only tournament creator can update match scores');
    }

    return this.matchModel.findByIdAndUpdate(
      matchId,
      {
        $set: {
          scoreA: dto.scoreA,
          scoreB: dto.scoreB,
          winnerId: dto.winnerId ? new Types.ObjectId(dto.winnerId) : null,
        },
      },
      { new: true },
    );
  }
}
