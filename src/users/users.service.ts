import { Injectable, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async findById(id: string): Promise<UserDocument> {
    return this.userModel.findById(id)
      .select('-passwordHash -emailVerificationToken -passwordResetToken -passwordResetExpiry')
      .lean() as Promise<UserDocument>;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<UserDocument> {
    if (dto.username) {
      const existing = await this.userModel.findOne({
        username: dto.username,
        _id: { $ne: userId },
      });
      if (existing) throw new ConflictException('Username already taken');
    }
    return this.userModel
      .findByIdAndUpdate(userId, { $set: dto }, { new: true })
      .select('-passwordHash -emailVerificationToken -passwordResetToken -passwordResetExpiry')
      .lean() as Promise<UserDocument>;
  }

  async updateAvatar(userId: string, filename: string): Promise<UserDocument> {
    return this.userModel
      .findByIdAndUpdate(
        userId,
        { $set: { profileImage: `/uploads/profiles/${filename}` } },
        { new: true },
      )
      .select('-passwordHash -emailVerificationToken -passwordResetToken -passwordResetExpiry')
      .lean() as Promise<UserDocument>;
  }
}
