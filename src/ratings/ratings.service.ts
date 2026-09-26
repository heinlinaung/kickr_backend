// src/ratings/ratings.service.ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  clampLimit,
  decodeCursor,
  keysetFilter,
  toPage,
} from '../common/pagination/cursor';
import { Event, EventDocument } from '../events/schemas/event.schema';
import {
  EventPlayer,
  EventPlayerDocument,
} from '../events/schemas/event-player.schema';
import { Group, GroupDocument } from '../groups/schemas/group.schema';
import {
  GroupMember,
  GroupMemberDocument,
} from '../groups/schemas/group-member.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateRatingDto } from './dto/create-rating.dto';
import {
  MAX_STARS,
  MIN_STARS,
  RATABLE_EVENT_STATUSES,
  RATING_TARGETS,
  Rating,
  RatingDocument,
} from './schemas/rating.schema';

/**
 * A rating as the API presents it.
 *
 * `rater` is null exactly when the rating is anonymous AND the viewer is not
 * its author — anonymity is applied here, at read time, never in storage.
 * `mine` saves clients comparing ids (and is the only way the author of an
 * anonymous rating can recognise it in a list).
 */
export interface PresentedRating {
  _id: Types.ObjectId;
  targetType: string;
  targetId: Types.ObjectId;
  stars: number;
  description: string | null;
  isAnonymous: boolean;
  rater: {
    _id: Types.ObjectId;
    name?: string;
    username?: string;
    profileImage?: string;
  } | null;
  mine: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

@Injectable()
export class RatingsService {
  constructor(
    @InjectModel(Rating.name) private ratingModel: Model<RatingDocument>,
    @InjectModel(Event.name) private eventModel: Model<EventDocument>,
    @InjectModel(EventPlayer.name)
    private playerModel: Model<EventPlayerDocument>,
    @InjectModel(Group.name) private groupModel: Model<GroupDocument>,
    @InjectModel(GroupMember.name)
    private memberModel: Model<GroupMemberDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  /**
   * Submit — or replace — the caller's rating of one target.
   *
   * An upsert on (raterId, targetType, targetId), so "edit my review" is the
   * same request as "rate": the second submission overwrites stars, text and
   * anonymity together. There is deliberately no separate PATCH — two write
   * paths to the same row would just be two places for the rules to drift.
   */
  async submit(raterId: string, dto: CreateRatingDto) {
    await this.assertEligible(raterId, dto.targetType, dto.targetId);

    const row = await this.ratingModel
      .findOneAndUpdate(
        {
          raterId: new Types.ObjectId(raterId),
          targetType: dto.targetType,
          targetId: new Types.ObjectId(dto.targetId),
        },
        {
          $set: {
            stars: dto.stars,
            // An omitted description CLEARS the old one: the upsert replaces
            // the whole review, and keeping stale text under a new star value
            // would misquote the rater.
            description: dto.description ?? null,
            isAnonymous: dto.isAnonymous ?? false,
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .lean();

    const [presented] = await this.present([row], raterId);
    return presented;
  }

  /**
   * One target's ratings, newest first, keyset-paginated.
   *
   * Readable by any authenticated user — eligibility gates WRITING a rating,
   * not seeing what a group or event is rated. Anonymous rows are masked per
   * viewer in `present`.
   */
  async list(
    targetType: string,
    targetId: string,
    limit: number | undefined,
    cursor: string | undefined,
    viewerId: string,
  ) {
    this.assertTargetRef(targetType, targetId);
    const pageSize = clampLimit(limit ?? NaN);

    const filter: Record<string, unknown> = {
      targetType,
      targetId: new Types.ObjectId(targetId),
    };
    if (cursor) {
      // Newest-first pages forward with $lt — "next" means OLDER rows.
      Object.assign(filter, keysetFilter(decodeCursor(cursor), 'createdAt', -1));
    }

    const rows = await this.ratingModel
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(pageSize + 1)
      .lean();

    const page = toPage(rows, pageSize, (row) => ({
      d: (row.createdAt ?? new Date(0)).toISOString(),
      i: row._id.toString(),
    }));

    return { ...page, items: await this.present(page.items, viewerId) };
  }

  /**
   * The aggregate a detail screen shows: average, count, per-star breakdown,
   * plus the viewer's own rating so the client can pre-fill the edit form.
   *
   * Computed on read, never stored — the same rule as standings — so the
   * numbers cannot drift from the rows they summarise.
   */
  async summary(targetType: string, targetId: string, viewerId: string) {
    this.assertTargetRef(targetType, targetId);
    const target = new Types.ObjectId(targetId);

    const grouped: { _id: number; count: number }[] =
      await this.ratingModel.aggregate([
        { $match: { targetType, targetId: target } },
        { $group: { _id: '$stars', count: { $sum: 1 } } },
      ]);

    const breakdown: Record<number, number> = {};
    for (let stars = MIN_STARS; stars <= MAX_STARS; stars++) {
      breakdown[stars] = 0;
    }
    let count = 0;
    let starSum = 0;
    for (const bucket of grouped) {
      breakdown[bucket._id] = bucket.count;
      count += bucket.count;
      starSum += bucket._id * bucket.count;
    }

    const own = await this.ratingModel
      .findOne({
        raterId: new Types.ObjectId(viewerId),
        targetType,
        targetId: target,
      })
      .lean();

    return {
      targetType,
      targetId,
      count,
      average: count === 0 ? 0 : Math.round((starSum / count) * 10) / 10,
      breakdown,
      myRating: own ? (await this.present([own], viewerId))[0] : null,
    };
  }

  /** Delete the caller's own rating. Nobody deletes anyone else's. */
  async remove(ratingId: string, callerId: string) {
    if (!Types.ObjectId.isValid(ratingId)) {
      throw new BadRequestException('Invalid rating id');
    }
    const row = await this.ratingModel.findById(ratingId);
    if (!row) throw new NotFoundException('Rating not found');
    if (row.raterId.toString() !== callerId) {
      throw new ForbiddenException('You can only delete your own rating');
    }
    await row.deleteOne();
    return { message: 'Rating deleted' };
  }

  /**
   * A user's average PLAYER rating, for profile statistics (§4.10 fills the
   * §4.4 stub). 0 when unrated — the stub's value, so the profile shape does
   * not change for users nobody has rated yet.
   */
  async averageForPlayer(userId: string): Promise<number> {
    if (!Types.ObjectId.isValid(userId)) return 0;
    const [row]: { average: number }[] = await this.ratingModel.aggregate([
      {
        $match: {
          targetType: 'player',
          targetId: new Types.ObjectId(userId),
        },
      },
      { $group: { _id: null, average: { $avg: '$stars' } } },
    ]);
    return row ? Math.round(row.average * 10) / 10 : 0;
  }

  // ---------------------------------------------------------------- private

  /**
   * The participation gate: rating is reserved for people who were there.
   *
   * - group  -> approved member (the owner cannot rate their own group)
   * - event  -> joined the roster, and the event is finished — after_match or
   *             done. A cancelled event never happened, so it is not ratable.
   * - player -> shared at least one finished event with them, and never
   *             yourself.
   *
   * Missing target -> 404. Wrong relationship -> 403. Self/own or wrong
   * status -> 400, since no change of membership could make it valid.
   */
  private async assertEligible(
    raterId: string,
    targetType: string,
    targetId: string,
  ) {
    this.assertTargetRef(targetType, targetId);
    const rater = new Types.ObjectId(raterId);
    const target = new Types.ObjectId(targetId);

    if (targetType === 'group') {
      const group = await this.groupModel
        .findById(target)
        .select('ownerId')
        .lean();
      if (!group) throw new NotFoundException('Group not found');
      if (group.ownerId?.toString() === raterId) {
        throw new BadRequestException('You cannot rate your own group');
      }
      const member = await this.memberModel.exists({
        groupId: target,
        userId: rater,
        status: 'approved',
      });
      if (!member) {
        throw new ForbiddenException(
          'Only approved members of this group can rate it',
        );
      }
      return;
    }

    if (targetType === 'event') {
      const event = await this.eventModel
        .findById(target)
        .select('createdBy status')
        .lean();
      if (!event) throw new NotFoundException('Event not found');
      if (event.createdBy?.toString() === raterId) {
        throw new BadRequestException('You cannot rate your own event');
      }
      if (!RATABLE_EVENT_STATUSES.includes(event.status as never)) {
        throw new BadRequestException(
          `Only a finished event can be rated (event is '${event.status}')`,
        );
      }
      const joined = await this.playerModel.exists({
        eventId: target,
        userId: rater,
        status: 'joined',
      });
      if (!joined) {
        throw new ForbiddenException(
          'Only players who joined this event can rate it',
        );
      }
      return;
    }

    // player
    if (targetId === raterId) {
      throw new BadRequestException('You cannot rate yourself');
    }
    const player = await this.userModel.findById(target).select('_id').lean();
    if (!player) throw new NotFoundException('Player not found');

    // "Played together": both appear as joined players on the same event,
    // and that event finished. Two indexed queries plus an intersection —
    // rosters are small, and this avoids an aggregate over the whole
    // players collection.
    const rows = await this.playerModel
      .find({ userId: { $in: [rater, target] }, status: 'joined' })
      .select('eventId userId')
      .lean();

    const mine = new Set<string>();
    const theirs = new Set<string>();
    for (const row of rows) {
      if (!row.userId || !row.eventId) continue;
      (row.userId.toString() === raterId ? mine : theirs).add(
        row.eventId.toString(),
      );
    }
    const shared = [...mine].filter((eventId) => theirs.has(eventId));

    const playedTogether =
      shared.length > 0 &&
      (await this.eventModel.exists({
        _id: { $in: shared.map((eventId) => new Types.ObjectId(eventId)) },
        status: { $in: RATABLE_EVENT_STATUSES },
      }));
    if (!playedTogether) {
      throw new ForbiddenException(
        'You can only rate a player after finishing an event together',
      );
    }
  }

  /** 400s for a bad target reference — shared by every read and write. */
  private assertTargetRef(targetType: string, targetId: string) {
    if (!RATING_TARGETS.includes(targetType as never)) {
      throw new BadRequestException(
        `Unknown targetType '${targetType}'. Valid values: ` +
          RATING_TARGETS.join(', '),
      );
    }
    if (!targetId || !Types.ObjectId.isValid(targetId)) {
      throw new BadRequestException('targetId must be a valid id');
    }
  }

  /**
   * Shape rows for one viewer, masking anonymous raters.
   *
   * One batched user lookup for every rater the viewer is allowed to see —
   * never per row, and never for raters who stay anonymous, so their ids do
   * not even leave this function.
   */
  private async present(
    rows: (Rating & { _id: Types.ObjectId })[],
    viewerId: string,
  ): Promise<PresentedRating[]> {
    const visibleRaterIds = [
      ...new Set(
        rows
          .filter(
            (row) => !row.isAnonymous || row.raterId.toString() === viewerId,
          )
          .map((row) => row.raterId.toString()),
      ),
    ];

    const raters = visibleRaterIds.length
      ? await this.userModel
          .find({ _id: { $in: visibleRaterIds } })
          .select('name username profileImage')
          .lean()
      : [];
    const byId = new Map(raters.map((user) => [user._id.toString(), user]));

    return rows.map((row) => {
      const mine = row.raterId.toString() === viewerId;
      const visible = !row.isAnonymous || mine;
      const rater = visible ? byId.get(row.raterId.toString()) : undefined;
      return {
        _id: row._id,
        targetType: row.targetType,
        targetId: row.targetId,
        stars: row.stars,
        description: row.description ?? null,
        isAnonymous: row.isAnonymous,
        rater: rater
          ? {
              _id: rater._id,
              name: rater.name,
              username: rater.username,
              profileImage: rater.profileImage,
            }
          : null,
        mine,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }
}
