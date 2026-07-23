import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import ImageKit from 'imagekit';
import { ImageKitService, IMAGEKIT_CLIENT } from './imagekit.service';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: IMAGEKIT_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const publicKey = config.get<string>('IMAGEKIT_PUBLIC_KEY');
        const privateKey = config.get<string>('IMAGEKIT_PRIVATE_KEY');
        const urlEndpoint = config.get<string>('IMAGEKIT_URL_ENDPOINT');
        if (!publicKey || !privateKey || !urlEndpoint) {
          throw new Error(
            'Missing required ImageKit configuration (IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, IMAGEKIT_URL_ENDPOINT)',
          );
        }
        return new ImageKit({ publicKey, privateKey, urlEndpoint });
      },
    },
    ImageKitService,
  ],
  exports: [ImageKitService],
})
export class UploadModule {}
