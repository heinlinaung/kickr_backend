import { memoryStorage } from 'multer';
import { BadRequestException } from '@nestjs/common';
import * as multer from 'multer';

const ALLOWED_IMAGE = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB (room for larger images)

export const multerMemoryImageOptions: multer.Options = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_SIZE_BYTES },
  fileFilter: (
    _req: Express.Request,
    file: Express.Multer.File,
    cb: multer.FileFilterCallback,
  ) => {
    if (!ALLOWED_IMAGE.includes(file.mimetype)) {
      return cb(
        new BadRequestException('Only JPEG, PNG, WebP images are allowed'),
      );
    }
    cb(null, true);
  },
};
