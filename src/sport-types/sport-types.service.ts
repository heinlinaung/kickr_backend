// src/sport-types/sport-types.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SportType, SportTypeDocument } from './schemas/sport-type.schema';

@Injectable()
export class SportTypesService {
  constructor(
    @InjectModel(SportType.name)
    private sportTypeModel: Model<SportTypeDocument>,
  ) {}

  /**
   * The whole list, in display order.
   *
   * Deliberately unpaginated: a fixed reference list of a handful of sports
   * that a client renders as a single picker, same reasoning as
   * `GlobalFootballTeamsService.findAll`.
   */
  async findAll() {
    return this.sportTypeModel
      .find()
      .select('value subTypes sortOrder')
      .sort({ sortOrder: 1, value: 1 })
      .lean();
  }

  /** One sport by its stored value, or null. Lean — callers only read it. */
  async findByValue(value: string) {
    return this.sportTypeModel
      .find({ value })
      .limit(1)
      .lean()
      .then((rows) => rows[0] ?? null);
  }

  /**
   * Rejects a `sportType` (and optionally a `subType`) that the collection
   * does not currently allow. The write-path replacement for the old inline
   * enums — group and event create/update call this instead of trusting a
   * hardcoded list in the DTO.
   *
   * Service-level rather than a class-validator decorator because the check
   * needs the database, and class-validator has no access to the Nest
   * container in this app (`useContainer` is never called in main.ts).
   *
   * The whole list is loaded rather than one row: it is a handful of
   * documents, and the failure message should name the valid values.
   */
  async assertValid(sportType: string, subType?: string | null): Promise<void> {
    const all = await this.findAll();
    const sport = all.find((row) => row.value === sportType);
    if (!sport) {
      const valid = all.map((row) => row.value).join(', ');
      throw new BadRequestException(
        `Unknown sportType '${sportType}'. Valid values: ${valid}`,
      );
    }

    if (!subType) return;
    if (!sport.subTypes.includes(subType)) {
      // Two different mistakes, two different messages: sending a subType to
      // a sport that has none, versus misspelling one where formats do exist.
      if (sport.subTypes.length === 0) {
        throw new BadRequestException(
          `subType is not valid for sportType '${sportType}'`,
        );
      }
      throw new BadRequestException(
        `Unknown subType '${subType}' for sportType '${sportType}'. ` +
          `Valid values: ${sport.subTypes.join(', ')}`,
      );
    }
  }
}
