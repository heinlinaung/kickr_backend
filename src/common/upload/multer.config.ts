// src/common/upload/multer.config.ts
import { diskStorage } from 'multer';
import { BadRequestException } from '@nestjs/common';
import { join } from 'path';
import * as fs from 'fs';
import * as multer from 'multer';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export function multerDiskOptions(subDir: string): multer.Options {
  const dest = join(process.cwd(), 'uploads', subDir);
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

  return {
    storage: diskStorage({
      destination: dest,
      filename: (req, file, cb) => {
        const userId =
          (req as Express.Request & { user?: { _id: string } }).user?._id ??
          'anon';
        const ext = MIME_TO_EXT[file.mimetype] ?? '.bin';
        const unique = `${userId}-${Date.now()}${ext}`;
        cb(null, unique);
      },
    }),
    limits: { fileSize: MAX_SIZE_BYTES },
    fileFilter: (
      _req: Express.Request,
      file: Express.Multer.File,
      cb: multer.FileFilterCallback,
    ) => {
      if (!ALLOWED_MIME.includes(file.mimetype)) {
        return cb(
          new BadRequestException('Only JPEG, PNG, WebP images are allowed'),
        );
      }
      cb(null, true);
    },
  };
}
