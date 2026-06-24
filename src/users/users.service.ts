import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument, USER_SENSITIVE_PROJECTION } from './schemas/user.schema';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

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

  async updateAvatar(userId: string, filename: string): Promise<UserDocument> {
    const user = await this.userModel
      .findByIdAndUpdate(
        userId,
        { $set: { profileImage: `/uploads/profiles/${filename}` } },
        { new: true },
      )
      .select(USER_SENSITIVE_PROJECTION)
      .lean();
    if (!user) throw new NotFoundException('User not found');
    return user as unknown as UserDocument;
  }
}
