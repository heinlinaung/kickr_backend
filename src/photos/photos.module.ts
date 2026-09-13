// src/photos/photos.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GroupPhotosController } from './group-photos.controller';
import { PhotosService } from './photos.service';
import { Photo, PhotoSchema } from './schemas/photo.schema';
import { UploadModule } from '../common/upload/upload.module';
import {
  GroupMember,
  GroupMemberSchema,
} from '../groups/schemas/group-member.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Photo.name, schema: PhotoSchema },
      // The MEMBER SCHEMA, not GroupsModule. Importing the module would close
      // a cycle — GroupsModule -> EventsModule -> PhotosModule -> GroupsModule
      // — which fails at boot with UndefinedModuleException. Registering the
      // schema keeps this module a leaf, the same approach NotificationsModule
      // and UsersModule use for their cross-module reads.
      { name: GroupMember.name, schema: GroupMemberSchema },
    ]),
    UploadModule,
  ],
  controllers: [GroupPhotosController],
  providers: [PhotosService],
  // EventsModule needs the service so event photos land in the same collection
  // — that shared storage is what puts them in the group gallery.
  exports: [PhotosService],
})
export class PhotosModule {}
