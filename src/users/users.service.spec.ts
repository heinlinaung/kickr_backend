import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { UsersService } from './users.service';
import { User } from './schemas/user.schema';
import { ImageKitService } from '../common/upload/imagekit.service';

describe('UsersService', () => {
  let service: UsersService;

  const userModel = {
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  };
  const imagekit = {
    upload: jest.fn(),
    deleteFile: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const m = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: ImageKitService, useValue: imagekit },
      ],
    }).compile();
    service = m.get(UsersService);
  });

  describe('updateAvatar', () => {
    it('uploads the buffer, stores url + fileId, and deletes the previous image', async () => {
      userModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ _id: 'u1', profileImageFileId: 'oldFid' }),
        }),
      });
      imagekit.upload.mockResolvedValue({
        url: 'https://ik.imagekit.io/kickr/profiles/new.jpg',
        fileId: 'newFid',
      });
      imagekit.deleteFile.mockResolvedValue(undefined);
      userModel.findByIdAndUpdate.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: 'u1',
            profileImage: 'https://ik.imagekit.io/kickr/profiles/new.jpg',
            profileImageFileId: 'newFid',
          }),
        }),
      });

      const file = { buffer: Buffer.from('img') } as Express.Multer.File;
      const result = await service.updateAvatar('u1', file);

      expect(imagekit.upload).toHaveBeenCalledWith(file.buffer, expect.stringContaining('u1-'), 'profiles');
      expect(imagekit.deleteFile).toHaveBeenCalledWith('oldFid');
      expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith(
        'u1',
        {
          $set: {
            profileImage: 'https://ik.imagekit.io/kickr/profiles/new.jpg',
            profileImageFileId: 'newFid',
          },
        },
        { new: true },
      );
      expect(result.profileImage).toBe('https://ik.imagekit.io/kickr/profiles/new.jpg');
      expect(result.profileImageFileId).toBe('newFid');
    });

    it('does not call deleteFile when there is no previous image', async () => {
      userModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ _id: 'u1' }),
        }),
      });
      imagekit.upload.mockResolvedValue({
        url: 'https://ik.imagekit.io/kickr/profiles/new.jpg',
        fileId: 'newFid',
      });
      userModel.findByIdAndUpdate.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: 'u1',
            profileImage: 'https://ik.imagekit.io/kickr/profiles/new.jpg',
            profileImageFileId: 'newFid',
          }),
        }),
      });

      const file = { buffer: Buffer.from('img') } as Express.Multer.File;
      await service.updateAvatar('u1', file);

      expect(imagekit.deleteFile).not.toHaveBeenCalled();
    });
  });
});
