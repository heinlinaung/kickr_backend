// src/formations/formations.service.ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Formation, FormationDocument } from './schemas/formation.schema';

@Injectable()
export class FormationsService {
  constructor(
    @InjectModel(Formation.name)
    private formationModel: Model<FormationDocument>,
  ) {}

  /** Every row in squad-size order — the shape the client's picker wants. */
  async findAll() {
    return this.formationModel
      .find()
      .select('name playerCount formation -_id')
      .sort({ playerCount: 1 })
      .lean();
  }
}
