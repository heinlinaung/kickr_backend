import { Injectable, ConflictException, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { User, UserDocument, USER_SENSITIVE_PROJECTION } from './schemas/user.schema';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ImageKitService } from '../common/upload/imagekit.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly imagekit: ImageKitService,
    private config: ConfigService,
  ) {}

  async findById(id: string): Promise<UserDocument> {
    const user = await this.userModel.findById(id)
      .select(USER_SENSITIVE_PROJECTION)
      .lean();
    if (!user) throw new NotFoundException('User not found');
    return user as unknown as UserDocument;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<UserDocument | null> {
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
        .lean() as unknown as UserDocument | null;
      if (!user) throw new NotFoundException('User not found');
      return user;
    } catch (err: any) {
      if (err?.code === 11000) throw new ConflictException('Username already taken');
      throw err;
    }
  }

  async updateAvatar(userId: string, file: Express.Multer.File): Promise<UserDocument> {
    const current = await this.userModel
      .findById(userId)
      .select('profileImageFileId')
      .lean();
    if (!current) throw new NotFoundException('User not found');
    const uploaded = await this.imagekit.upload(file.buffer, `${userId}-${Date.now()}`, 'profiles');
    // best-effort cleanup of the previous image (a failed delete must not fail
    // the avatar update, but we log so orphaned CDN files are traceable)
    const prevFileId = (current as any).profileImageFileId;
    if (prevFileId) {
      try {
        await this.imagekit.deleteFile(prevFileId);
      } catch (err) {
        this.logger.warn(`Failed to delete previous avatar ${prevFileId}: ${err}`);
      }
    }
    const user = await this.userModel
      .findByIdAndUpdate(
        userId,
        { $set: { profileImage: uploaded.url, profileImageFileId: uploaded.fileId } },
        { new: true },
      )
      .select(USER_SENSITIVE_PROJECTION)
      .lean();
    if (!user) throw new NotFoundException('User not found');
    return user as unknown as UserDocument;
  }

  async getQr(userId: string): Promise<{ inviteCode: string; inviteLink: string }> {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    let code = user.inviteCode;
    if (!code) {
      code = uuidv4();
      await this.userModel.findByIdAndUpdate(userId, { $set: { inviteCode: code } });
    }
    const base = this.config.get<string>('APP_BASE_URL') ?? '';
    return { inviteCode: code, inviteLink: `${base}/u/${code}` };
  }
}
