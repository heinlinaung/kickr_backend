import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import {
  User,
  UserDocument,
  USER_SENSITIVE_PROJECTION,
} from './schemas/user.schema';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ImageKitService } from '../common/upload/imagekit.service';
import {
  EventPlayer,
  EventPlayerDocument,
} from '../events/schemas/event-player.schema';
import { Event, EventDocument } from '../events/schemas/event.schema';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly imagekit: ImageKitService,
    private config: ConfigService,
    @InjectModel(EventPlayer.name)
    private playerModel: Model<EventPlayerDocument>,
    @InjectModel(Event.name) private eventModel: Model<EventDocument>,
  ) {}

  async findById(id: string): Promise<UserDocument> {
    const user = await this.userModel
      .findById(id)
      .select(USER_SENSITIVE_PROJECTION)
      .lean();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<UserDocument | null> {
    if (dto.username !== undefined) {
      const existing = await this.userModel.findOne({
        username: dto.username,
        _id: { $ne: userId },
      });
      if (existing) throw new ConflictException('Username already taken');
    }
    try {
      const user = await this.userModel
        .findByIdAndUpdate(userId, { $set: dto }, { new: true })
        .select(USER_SENSITIVE_PROJECTION)
        .lean();
      if (!user) throw new NotFoundException('User not found');
      return user;
    } catch (err: any) {
      if (err?.code === 11000)
        throw new ConflictException('Username already taken');
      throw err;
    }
  }

  async updateAvatar(
    userId: string,
    file: Express.Multer.File,
  ): Promise<UserDocument> {
    const current = await this.userModel
      .findById(userId)
      .select('profileImageFileId')
      .lean();
    if (!current) throw new NotFoundException('User not found');
    const uploaded = await this.imagekit.upload(
      file.buffer,
      `${userId}-${Date.now()}`,
      'profiles',
    );
    // best-effort cleanup of the previous image (a failed delete must not fail
    // the avatar update, but we log so orphaned CDN files are traceable)
    const prevFileId = (current as any).profileImageFileId;
    if (prevFileId) {
      try {
        await this.imagekit.deleteFile(prevFileId);
      } catch (err) {
        this.logger.warn(
          `Failed to delete previous avatar ${prevFileId}: ${err}`,
        );
      }
    }
    const user = await this.userModel
      .findByIdAndUpdate(
        userId,
        {
          $set: {
            profileImage: uploaded.url,
            profileImageFileId: uploaded.fileId,
          },
        },
        { new: true },
      )
      .select(USER_SENSITIVE_PROJECTION)
      .lean();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async getQr(
    userId: string,
  ): Promise<{ inviteCode: string; inviteLink: string }> {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    let code = user.inviteCode;
    if (!code) {
      code = uuidv4();
      await this.userModel.findByIdAndUpdate(userId, {
        $set: { inviteCode: code },
      });
    }
    const base = this.config.get<string>('APP_BASE_URL') ?? '';
    return { inviteCode: code, inviteLink: `${base}/u/${code}` };
  }

  private readonly PUBLIC_FIELDS = [
    '_id',
    'name',
    'username',
    'displayName',
    'profileImage',
    'biography',
    'country',
    'city',
    'sports',
    'preferredSport',
    'footballPosition',
    'height',
    'weight',
    'dateOfBirth',
    'gallery',
    'highlightVideos',
    'createdAt',
  ];

  // Return an ObjectId when the id is a valid hex string; otherwise return the
  // raw value and let Mongoose's query casting handle it (avoids a hard throw
  // from `new Types.ObjectId()` on unexpected input).
  private toUserIdFilter(userId: string): Types.ObjectId | string {
    return Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : userId;
  }

  private async getMatchHistory(userId: string) {
    const rows = await this.playerModel
      .find({ userId: this.toUserIdFilter(userId), status: 'joined' })
      .lean();
    const eventIds = rows.map((r) => r.eventId);
    if (eventIds.length === 0) return [];
    return this.eventModel
      .find({ _id: { $in: eventIds } })
      .select('title date locationId sportType status')
      .populate('locationId', 'name lat lng')
      .sort({ date: -1 })
      .lean();
  }

  private async buildStatistics(userId: string) {
    // matchesPlayed is real. wins/mvpCount/avgRating require Event after-match
    // results (§4.5) and ratings (§4.10) which are not built yet — return 0.
    const matchesPlayed = await this.playerModel.countDocuments({
      userId: this.toUserIdFilter(userId),
      status: 'joined',
    });
    return {
      matchesPlayed,
      wins: 0, // TODO(§4.5)
      mvpCount: 0, // TODO(§4.5)
      avgRating: 0, // TODO(§4.10)
    };
  }

  async getPublicProfile(targetUserId: string) {
    // Defense-in-depth: fetch ONLY the public fields (+ privacy for the gate)
    // from the DB, so email/phone/cognitoSub never reach memory on this
    // public endpoint even if the allowlist copy below is later changed.
    const user = await this.userModel
      .findById(targetUserId)
      .select([...this.PUBLIC_FIELDS, 'privacy'].join(' '))
      .lean();
    if (!user) throw new NotFoundException('User not found');
    const privacy = (user as any).privacy ?? {
      profileVisibility: 'public',
      showStats: true,
      showMatchHistory: true,
    };
    // 'private' hides the profile; 'members' treated as public for now (TODO: scope to shared groups)
    if (privacy.profileVisibility === 'private') {
      throw new NotFoundException('Profile is private');
    }
    const base: Record<string, unknown> = {};
    for (const f of this.PUBLIC_FIELDS) {
      if ((user as any)[f] !== undefined) base[f] = (user as any)[f];
    }
    if (privacy.showStats)
      base.statistics = await this.buildStatistics(targetUserId);
    if (privacy.showMatchHistory)
      base.matchHistory = await this.getMatchHistory(targetUserId);
    return base;
  }
}
