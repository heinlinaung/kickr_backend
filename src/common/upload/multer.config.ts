import { diskStorage } from 'multer';
import { extname } from 'path';
import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export function multerDiskOptions(subDir: string) {
  const dest = `./uploads/${subDir}`;
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

  return {
    storage: diskStorage({
      destination: dest,
      filename: (_req, file, cb) => {
        const userId = (_req as any).user?._id ?? 'anon';
        const unique = `${userId}-${Date.now()}${extname(file.originalname)}`;
        cb(null, unique);
      },
    }),
    limits: { fileSize: MAX_SIZE_BYTES },
    fileFilter: (_req: any, file: Express.Multer.File, cb: any) => {
      if (!ALLOWED_MIME.includes(file.mimetype)) {
        return cb(new BadRequestException('Only JPEG, PNG, WebP images are allowed'), false);
      }
      cb(null, true);
    },
  };
}
