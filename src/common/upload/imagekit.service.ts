import { Injectable, Inject } from '@nestjs/common';
import ImageKit from 'imagekit';

export const IMAGEKIT_CLIENT = 'IMAGEKIT_CLIENT';

export interface UploadResult {
  url: string;
  fileId: string;
}

@Injectable()
export class ImageKitService {
  constructor(@Inject(IMAGEKIT_CLIENT) private readonly client: ImageKit) {}

  async upload(
    file: Buffer,
    fileName: string,
    folder: string,
  ): Promise<UploadResult> {
    const res = await this.client.upload({
      file,
      fileName,
      folder: `/${folder}`,
    });
    return { url: res.url, fileId: res.fileId };
  }

  async deleteFile(fileId: string): Promise<void> {
    if (!fileId) return;
    await this.client.deleteFile(fileId);
  }
}
