// src/countries/countries.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Country, CountryDocument, Region } from './schemas/country.schema';
import { Group, GroupDocument } from '../groups/schemas/group.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateCountryDto } from './dto/create-country.dto';
import { UpdateCountryDto } from './dto/update-country.dto';
import {
  PLACE_ID,
  PLACE_ID_MESSAGE,
  RegionDto,
  toPlaceId,
} from './dto/region.dto';

const PUBLIC_FIELDS = '-_id id name sortOrder regions';

@Injectable()
export class CountriesService {
  constructor(
    @InjectModel(Country.name)
    private countryModel: Model<CountryDocument>,
    @InjectModel(Group.name)
    private groupModel: Model<GroupDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
  ) {}

  /**
   * Every country with its regions, in display order. Unpaginated for the
   * same reason as `SportTypesService.findAll`: a small reference list the
   * client renders as one picker.
   */
  async findAll() {
    return this.countryModel
      .find()
      .select(PUBLIC_FIELDS)
      .sort({ sortOrder: 1, id: 1 })
      .lean();
  }

  /**
   * The regions keyed by country id — the shape the apps read:
   * `{ regions: { myanmar: [{ id, name }], thailand: [...] } }`.
   * Countries keep display order as key insertion order.
   */
  async findRegionsMap() {
    const countries = await this.findAll();
    const regions: Record<string, Region[]> = {};
    for (const country of countries) regions[country.id] = country.regions;
    return { regions };
  }

  /** One country by id: 404 instead of null. */
  async findOne(id: string) {
    const country = await this.countryModel
      .findOne({ id: toPlaceId(id) })
      .select(PUBLIC_FIELDS)
      .lean();
    if (!country) throw new NotFoundException(`Country '${id}' not found`);
    return country;
  }

  // --- Admin writes ------------------------------------------------------
  //
  // Guarded by SuperadminGuard in the controller. Ids are never changed after
  // create — groups and users store them as `country` / `city`.

  async create(dto: CreateCountryDto) {
    const id = deriveId(dto.id, dto.name, 'id');
    if (await this.countryModel.exists({ id })) {
      throw new ConflictException(`Country '${id}' already exists`);
    }

    // Omitted sortOrder appends: one past the current last row.
    let sortOrder = dto.sortOrder;
    if (sortOrder === undefined) {
      const last = await this.countryModel
        .findOne()
        .sort({ sortOrder: -1 })
        .select('sortOrder')
        .lean();
      sortOrder = (last?.sortOrder ?? 0) + 1;
    }

    await this.countryModel.create({
      id,
      name: dto.name,
      sortOrder,
      regions: toRegions(dto.regions ?? []),
    });
    return this.findOne(id);
  }

  /**
   * Updates `name` and/or `sortOrder`, and/or replaces `regions`. A body `id`
   * must match — ids never change. Replacing the list may drop a region —
   * refused while a group or user still has it as their city.
   */
  async update(id: string, dto: UpdateCountryDto) {
    const country = await this.findOne(id);
    if (dto.id !== undefined && dto.id !== country.id) {
      throw new BadRequestException(
        `Body id '${dto.id}' does not match '${country.id}' — ids cannot change`,
      );
    }

    const $set: Partial<Country> = {};
    if (dto.name !== undefined) $set.name = dto.name;
    if (dto.sortOrder !== undefined) $set.sortOrder = dto.sortOrder;
    if (dto.regions !== undefined) {
      const next = toRegions(dto.regions);
      const keep = new Set(next.map((r) => r.id));
      for (const region of country.regions) {
        if (!keep.has(region.id)) {
          await this.assertRegionUnused(country.id, region.id);
        }
      }
      $set.regions = next;
    }

    if (Object.keys($set).length) {
      await this.countryModel.updateOne({ id: country.id }, { $set });
    }
    return this.findOne(country.id);
  }

  /** Deletes a country — refused while a group or user still stores it. */
  async remove(id: string) {
    const country = await this.findOne(id);
    await this.assertUnused({ country: country.id }, `Country '${country.id}'`);
    await this.countryModel.deleteOne({ id: country.id });
    return { deleted: true, id: country.id };
  }

  /** Appends one region. A duplicate id within the country is a 409. */
  async addRegion(countryId: string, dto: RegionDto) {
    const country = await this.findOne(countryId);
    const [region] = toRegions([dto]);

    // The `$ne` filter makes the duplicate check and the push one atomic
    // step, so two concurrent adds of the same id cannot both land.
    const res = await this.countryModel.updateOne(
      { id: country.id, 'regions.id': { $ne: region.id } },
      { $push: { regions: region } },
    );
    if (res.modifiedCount === 0) {
      throw new ConflictException(
        `Region '${region.id}' already exists in country '${country.id}'`,
      );
    }
    return this.findOne(country.id);
  }

  /** Changes a region's display name. Its id stays — it is stored on groups/users. */
  async updateRegion(countryId: string, regionId: string, name: string) {
    const country = await this.findOne(countryId);
    const region = findRegion(country, regionId);
    await this.countryModel.updateOne(
      { id: country.id, 'regions.id': region.id },
      { $set: { 'regions.$.name': name } },
    );
    return this.findOne(country.id);
  }

  /** Removes a region — refused while a group or user has it as their city. */
  async removeRegion(countryId: string, regionId: string) {
    const country = await this.findOne(countryId);
    const region = findRegion(country, regionId);
    await this.assertRegionUnused(country.id, region.id);
    await this.countryModel.updateOne(
      { id: country.id },
      { $pull: { regions: { id: region.id } } },
    );
    return this.findOne(country.id);
  }

  private assertRegionUnused(countryId: string, regionId: string) {
    return this.assertUnused(
      { country: countryId, city: regionId },
      `Region '${regionId}' of country '${countryId}'`,
    );
  }

  /**
   * Deleting a value still stored on groups or users would leave them
   * pointing at something the pickers no longer offer. Counts each holder so
   * the message says what to fix.
   */
  private async assertUnused(filter: Record<string, string>, label: string) {
    const [groups, users] = await Promise.all([
      this.groupModel.countDocuments(filter),
      this.userModel.countDocuments(filter),
    ]);
    const usage = [
      groups && `${groups} groups`,
      users && `${users} users`,
    ].filter(Boolean);
    if (usage.length) {
      throw new ConflictException(
        `${label} is still in use (${usage.join(', ')})`,
      );
    }
  }
}

/**
 * The given id, or one derived from the name. A name that does not reduce to
 * a valid id (e.g. non-Latin script) needs an explicit id.
 */
function deriveId(id: string | undefined, name: string, field: string): string {
  const out = id ?? toPlaceId(name);
  if (!PLACE_ID.test(out)) {
    throw new BadRequestException(
      `${field} '${out}' ${PLACE_ID_MESSAGE} — send an explicit ${field}`,
    );
  }
  return out;
}

/** Normalises a region list, rejecting duplicate ids. */
function toRegions(input: RegionDto[]): Region[] {
  const seen = new Set<string>();
  return input.map((r) => {
    const id = deriveId(r.id, r.name, 'region id');
    if (seen.has(id)) {
      throw new BadRequestException(`Duplicate region id '${id}'`);
    }
    seen.add(id);
    return { id, name: r.name };
  });
}

function findRegion(
  country: { id: string; regions: Region[] },
  regionId: string,
) {
  const id = toPlaceId(regionId);
  const region = country.regions.find((r) => r.id === id);
  if (!region) {
    throw new NotFoundException(
      `Region '${regionId}' not found in country '${country.id}'`,
    );
  }
  return region;
}
