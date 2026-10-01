// src/formations/formations.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Formation, FormationSchema } from './schemas/formation.schema';
import { FormationsController } from './formations.controller';
import { FormationsService } from './formations.service';

/**
 * A leaf, like SportTypes: reference data with one list endpoint, changed by
 * re-running `scripts/seed-formations.ts` rather than through the API.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Formation.name, schema: FormationSchema },
    ]),
  ],
  controllers: [FormationsController],
  providers: [FormationsService],
  exports: [FormationsService],
})
export class FormationsModule {}
