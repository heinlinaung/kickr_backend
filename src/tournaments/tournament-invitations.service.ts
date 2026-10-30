import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Tournament, TournamentDocument } from './schemas/tournament.schema';
import {
  TournamentTeam,
  TournamentTeamDocument,
} from './schemas/tournament-team.schema';
import {
  TournamentInvitation,
  TournamentInvitationDocument,
  TournamentInvitationStatus,
} from './schemas/tournament-invitation.schema';
import {
  GroupMember,
  GroupMemberDocument,
} from '../groups/schemas/group-member.schema';
import { Group, GroupDocument } from '../groups/schemas/group.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { TournamentsService } from './tournaments.service';
import {
  APPROVED_REGISTRATION,
  PRE_START_STATUSES,
} from './tournament.constants';
import { TournamentErrorCode, tournamentError } from './tournaments.errors';
import {
  AcceptTournamentInvitationDto,
  CreateTournamentInvitationsDto,
} from './dto/tournament-invitation.dto';

export const INVITATION_LIST_STATUSES = [
  'pending',
  'accepted',
  'declined',
  'revoked',
  'expired',
] as const;
export type InvitationListStatus = (typeof INVITATION_LIST_STATUSES)[number];

/** Statuses in which the organizer can send invitations. */
const INVITABLE_STATUSES = ['DRAFT', 'REGISTRATION_OPEN'];

type InviteResult =
  | { groupId: string; status: 'INVITED'; invitationId: string }
  | {
      groupId: string;
      status: 'FAILED';
      error: { code: TournamentErrorCode };
    };

/**
 * The organizer inviting Groups (clubs) to enter a team. A group's owner or
 * an admin answers; accepting registers the team through the normal
 * registration path, with `clubId` set to the group.
 */
@Injectable()
export class TournamentInvitationsService {
  constructor(
    @InjectModel(TournamentInvitation.name)
    private invitationModel: Model<TournamentInvitationDocument>,
    @InjectModel(Tournament.name)
    private tournamentModel: Model<TournamentDocument>,
    @InjectModel(TournamentTeam.name)
    private teamModel: Model<TournamentTeamDocument>,
    @InjectModel(Group.name) private groupModel: Model<GroupDocument>,
    @InjectModel(GroupMember.name)
    private memberModel: Model<GroupMemberDocument>,
    private readonly tournamentsService: TournamentsService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * `POST /tournaments/:id/invitations`. Tournament-level checks fail the
   * whole call; each group is then checked on its own and reported in
   * `results[]`.
   */
  async invite(
    callerId: string,
    tournamentId: string,
    dto: CreateTournamentInvitationsDto,
  ) {
    const tournament = await this.loadOwned(tournamentId, callerId);
    if (!INVITABLE_STATUSES.includes(tournament.status)) {
      throw tournamentError(
        'TOURNAMENT_CLOSED',
        `Invitations can't be sent while the tournament is ${tournament.status}`,
      );
    }

    const groupIds = [...new Set(dto.groupIds)];
    const oids = groupIds.map((id) => new Types.ObjectId(id));
    const [groups, registered, pending] = await Promise.all([
      this.groupModel
        .find({ _id: { $in: oids } })
        .select('_id')
        .lean(),
      this.teamModel.distinct('clubId', {
        tournamentId: tournament._id,
        clubId: { $in: oids },
        ...APPROVED_REGISTRATION,
      }),
      this.invitationModel.distinct('groupId', {
        tournamentId: tournament._id,
        groupId: { $in: oids },
        status: 'PENDING',
      }),
    ]);
    const existing = new Set(groups.map((g) => g._id.toString()));
    const registeredSet = new Set(registered.map(String));
    const pendingSet = new Set(pending.map(String));
    const isFull = tournament.currentTeams >= tournament.maxTeams;

    const results: InviteResult[] = [];
    const invited: string[] = [];
    for (const groupId of groupIds) {
      const code: TournamentErrorCode | null = !existing.has(groupId)
        ? 'GROUP_NOT_FOUND'
        : registeredSet.has(groupId)
          ? 'ALREADY_REGISTERED'
          : pendingSet.has(groupId)
            ? 'INVITATION_EXISTS'
            : isFull
              ? 'TOURNAMENT_FULL'
              : null;
      if (code) {
        results.push({ groupId, status: 'FAILED', error: { code } });
        continue;
      }
      try {
        const row = await this.invitationModel.create({
          tournamentId: tournament._id,
          groupId: new Types.ObjectId(groupId),
          invitedBy: new Types.ObjectId(callerId),
          message: dto.message ?? null,
          status: 'PENDING',
        });
        results.push({
          groupId,
          status: 'INVITED',
          invitationId: row._id.toString(),
        });
        invited.push(groupId);
      } catch (err) {
        // Invited a moment ago by a concurrent call.
        if ((err as { code?: number })?.code !== 11000) throw err;
        results.push({
          groupId,
          status: 'FAILED',
          error: { code: 'INVITATION_EXISTS' },
        });
      }
    }

    if (invited.length) {
      const admins = await this.memberModel.distinct('userId', {
        groupId: { $in: invited.map((id) => new Types.ObjectId(id)) },
        status: 'approved',
        role: { $in: ['owner', 'admin'] },
      });
      await this.notifications.notifyUsers(admins.map(String), {
        title: 'Tournament invitation',
        body: `Your group is invited to '${tournament.title}'`,
        type: 'tournament',
        refId: tournament._id.toString(),
      });
    }

    return { results };
  }

  /** `GET /tournaments/:id/invitations` — the organizer's sent list. */
  async listSent(
    callerId: string,
    tournamentId: string,
    status?: InvitationListStatus,
  ) {
    const tournament = await this.loadOwned(tournamentId, callerId);
    const filter: Record<string, unknown> = { tournamentId: tournament._id };
    if (status) filter.status = status.toUpperCase();
    const rows = await this.invitationModel
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .lean();

    const groups = await this.groupModel
      .find({ _id: { $in: rows.map((r) => r.groupId) } })
      .select('name handle logo')
      .lean();
    const groupById = new Map(groups.map((g) => [g._id.toString(), g]));

    return rows.map((row) => {
      const group = groupById.get(row.groupId.toString());
      return {
        ...this.toItem(row),
        group: group
          ? {
              id: group._id.toString(),
              name: group.name,
              handle: group.handle ?? null,
              logo: group.logo ?? null,
            }
          : null,
      };
    });
  }

  /**
   * `GET /groups/:groupId/tournament-invitations` — invitations the group
   * received, newest first. Owner/admin only.
   */
  async listReceived(
    callerId: string,
    groupId: string,
    status: InvitationListStatus,
  ) {
    const gid = await this.assertGroupAdmin(groupId, callerId);
    await this.expireClosed(gid);

    const rows = await this.invitationModel
      .find({
        groupId: gid,
        status: status.toUpperCase() as TournamentInvitationStatus,
      })
      .sort({ createdAt: -1, _id: -1 })
      .lean();

    const tournaments = await this.tournamentModel
      .find({ _id: { $in: rows.map((r) => r.tournamentId) } })
      .select(
        'title format status startDate maxTeams currentTeams groupId createdBy',
      )
      .lean();
    const hosts = await this.groupModel
      .find({
        _id: { $in: tournaments.map((t) => t.groupId).filter(Boolean) },
      })
      .select('name')
      .lean();
    const tournamentById = new Map(
      tournaments.map((t) => [t._id.toString(), t]),
    );
    const hostNameById = new Map(hosts.map((g) => [g._id.toString(), g.name]));

    return rows.map((row) => {
      const t = tournamentById.get(row.tournamentId.toString());
      return {
        ...this.toItem(row),
        tournament: t
          ? {
              id: t._id.toString(),
              title: t.title,
              format: t.format,
              status: t.status,
              startDate: t.startDate ?? null,
              maxTeams: t.maxTeams,
              currentTeams: t.currentTeams,
              hostGroupName: t.groupId
                ? (hostNameById.get(t.groupId.toString()) ?? null)
                : null,
            }
          : null,
      };
    });
  }

  /**
   * `POST /tournament-invitations/:invitationId/accept`. The invitation is
   * claimed first, so two admins accepting at once register one team; if
   * registration then fails the claim is handed back.
   */
  async accept(
    callerId: string,
    invitationId: string,
    dto: AcceptTournamentInvitationDto,
  ) {
    const invitation = await this.findForGroupAdmin(invitationId, callerId);
    const tournament = await this.tournamentModel
      .findById(invitation.tournamentId)
      .lean();
    if (!tournament || !PRE_START_STATUSES.includes(tournament.status)) {
      await this.setStatus(invitation._id, 'EXPIRED');
      throw this.closed();
    }
    // Pre-start but not open (DRAFT, closed for now): it may reopen.
    if (tournament.status !== 'REGISTRATION_OPEN') throw this.closed();
    if (tournament.currentTeams >= tournament.maxTeams) {
      throw tournamentError('TOURNAMENT_FULL', 'This tournament is full');
    }
    const alreadyIn = await this.teamModel.exists({
      tournamentId: tournament._id,
      clubId: invitation.groupId,
      ...APPROVED_REGISTRATION,
    });
    if (alreadyIn) {
      throw tournamentError(
        'ALREADY_REGISTERED',
        'This group already has a team in the tournament',
      );
    }

    const claimed = await this.invitationModel.findOneAndUpdate(
      { _id: invitation._id, status: 'PENDING' },
      {
        $set: {
          status: 'ACCEPTED',
          respondedAt: new Date(),
          respondedBy: new Types.ObjectId(callerId),
        },
      },
      { new: true },
    );
    if (!claimed) throw this.notPending();

    let team: TournamentTeamDocument;
    try {
      team = await this.tournamentsService.registerTeam(
        tournament._id.toString(),
        callerId,
        { ...dto, clubId: invitation.groupId.toString() },
      );
    } catch (err) {
      await this.invitationModel.updateOne(
        { _id: invitation._id, status: 'ACCEPTED' },
        { $set: { status: 'PENDING', respondedAt: null, respondedBy: null } },
      );
      throw err;
    }

    await this.invitationModel.updateOne(
      { _id: invitation._id },
      { $set: { teamId: team._id } },
    );
    return {
      id: invitation._id.toString(),
      status: 'ACCEPTED',
      tournamentId: tournament._id.toString(),
      team,
    };
  }

  /** `POST /tournament-invitations/:invitationId/decline`. */
  async decline(callerId: string, invitationId: string) {
    const invitation = await this.findForGroupAdmin(invitationId, callerId);
    const updated = await this.invitationModel.findOneAndUpdate(
      { _id: invitation._id, status: 'PENDING' },
      {
        $set: {
          status: 'DECLINED',
          respondedAt: new Date(),
          respondedBy: new Types.ObjectId(callerId),
        },
      },
      { new: true },
    );
    if (!updated) throw this.notPending();

    const group = await this.groupModel
      .findById(invitation.groupId)
      .select('name')
      .lean();
    await this.notifications.notifyUsers([invitation.invitedBy.toString()], {
      title: 'Tournament invitation declined',
      body: `${group?.name ?? 'A group'} declined your tournament invitation`,
      type: 'tournament',
      refId: invitation.tournamentId.toString(),
    });
    return { id: invitation._id.toString(), status: 'DECLINED' };
  }

  /** `DELETE /tournament-invitations/:invitationId` — the organizer withdraws it. */
  async revoke(callerId: string, invitationId: string) {
    const invitation = Types.ObjectId.isValid(invitationId)
      ? await this.invitationModel.findById(invitationId).lean()
      : null;
    if (!invitation) throw this.notFound();
    await this.loadOwned(invitation.tournamentId.toString(), callerId);
    if (!(await this.setStatus(invitation._id, 'REVOKED'))) {
      throw this.notPending();
    }
  }

  // --- Internals -------------------------------------------------------------

  private async loadOwned(tournamentId: string, userId: string) {
    const t = Types.ObjectId.isValid(tournamentId)
      ? await this.tournamentModel.findById(tournamentId).lean()
      : null;
    if (!t)
      throw tournamentError('TOURNAMENT_NOT_FOUND', 'Tournament not found');
    if (t.createdBy.toString() !== userId) {
      throw tournamentError(
        'NOT_ORGANIZER',
        'Only the tournament organizer can do this',
      );
    }
    return t;
  }

  private async assertGroupAdmin(groupId: string, userId: string) {
    if (!Types.ObjectId.isValid(groupId)) {
      throw tournamentError('GROUP_NOT_FOUND', 'Group not found');
    }
    const gid = new Types.ObjectId(groupId);
    if (!(await this.groupModel.exists({ _id: gid }))) {
      throw tournamentError('GROUP_NOT_FOUND', 'Group not found');
    }
    const admin = await this.memberModel.exists({
      groupId: gid,
      userId: new Types.ObjectId(userId),
      status: 'approved',
      role: { $in: ['owner', 'admin'] },
    });
    if (!admin) {
      throw tournamentError(
        'NOT_GROUP_ADMIN',
        'Only the group owner or an admin can manage tournament invitations',
      );
    }
    return gid;
  }

  /**
   * A PENDING invitation to a group the caller owns or admins. Anything else
   * reads as not found, so invitation ids cannot be probed.
   */
  private async findForGroupAdmin(invitationId: string, callerId: string) {
    const invitation = Types.ObjectId.isValid(invitationId)
      ? await this.invitationModel.findById(invitationId).lean()
      : null;
    const admin =
      invitation &&
      (await this.memberModel.exists({
        groupId: invitation.groupId,
        userId: new Types.ObjectId(callerId),
        status: 'approved',
        role: { $in: ['owner', 'admin'] },
      }));
    if (!invitation || !admin) throw this.notFound();
    if (invitation.status !== 'PENDING') throw this.notPending();
    return invitation;
  }

  /**
   * Marks the group's pending invitations to tournaments that can no longer
   * take teams — a phase started, completed, cancelled or deleted — as
   * `EXPIRED`. Done lazily on read, so the tournament lifecycle needs no hook.
   */
  private async expireClosed(groupId: Types.ObjectId) {
    const ids: Types.ObjectId[] = await this.invitationModel.distinct(
      'tournamentId',
      { groupId, status: 'PENDING' },
    );
    if (!ids.length) return;
    const open = await this.tournamentModel.distinct('_id', {
      _id: { $in: ids },
      status: { $in: PRE_START_STATUSES },
    });
    const openSet = new Set(open.map(String));
    const closed = ids.filter((id) => !openSet.has(id.toString()));
    if (!closed.length) return;
    await this.invitationModel.updateMany(
      { groupId, status: 'PENDING', tournamentId: { $in: closed } },
      { $set: { status: 'EXPIRED', respondedAt: new Date() } },
    );
  }

  /** PENDING → `status`, atomically; null if it had already left PENDING. */
  private setStatus(id: Types.ObjectId, status: TournamentInvitationStatus) {
    return this.invitationModel.findOneAndUpdate(
      { _id: id, status: 'PENDING' },
      { $set: { status, respondedAt: new Date() } },
      { new: true },
    );
  }

  private toItem(row: TournamentInvitation & { _id: Types.ObjectId }) {
    return {
      id: row._id.toString(),
      tournamentId: row.tournamentId.toString(),
      groupId: row.groupId.toString(),
      invitedBy: row.invitedBy.toString(),
      message: row.message ?? null,
      status: row.status,
      teamId: row.teamId?.toString() ?? null,
      respondedAt: row.respondedAt ?? null,
      createdAt: row.createdAt,
    };
  }

  private notFound() {
    return tournamentError('INVITATION_NOT_FOUND', 'Invitation not found');
  }

  private notPending() {
    return tournamentError(
      'INVITATION_NOT_PENDING',
      'This invitation was already answered, revoked or expired',
    );
  }

  private closed() {
    return tournamentError(
      'TOURNAMENT_CLOSED',
      'This tournament is not accepting registrations',
    );
  }
}
