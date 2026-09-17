// src/sport-types/sport-types.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SportType, SportTypeSchema } from './schemas/sport-type.schema';
import { SportTypesController } from './sport-types.controller';
import { SportTypesService } from './sport-types.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SportType.name, schema: SportTypeSchema },
    ]),
  ],
  controllers: [SportTypesController],
  providers: [SportTypesService],
  // Exported so GroupsModule and EventsModule can validate a sportType against
  // the collection without re-registering the model.
  exports: [SportTypesService],
})
export class SportTypesModule {}
