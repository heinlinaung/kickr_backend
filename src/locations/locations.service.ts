import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Location, LocationDocument } from './schemas/location.schema';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

@Injectable()
export class LocationsService {
  constructor(
    @InjectModel(Location.name)
    private locationModel: Model<LocationDocument>,
  ) {}

  /**
   * Locations are creator-owned, not a shared registry: this ALWAYS inserts a
   * new row. Two users adding the same pitch intentionally produce two rows,
   * so there is deliberately no name/proximity dedupe lookup here.
   */
  async create(
    userId: string,
    dto: CreateLocationDto,
  ): Promise<LocationDocument> {
    return this.locationModel.create({
      ...dto,
      createdBy: new Types.ObjectId(userId),
    });
  }

  async listMine(userId: string) {
    return this.locationModel
      .find({ createdBy: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .lean();
  }

  async findById(locationId: string): Promise<LocationDocument> {
    const location = await this.locationModel.findById(locationId).lean();
    if (!location) throw new NotFoundException('Location not found');
    return location as unknown as LocationDocument;
  }

  /**
   * Owner-gated. Loads the document and persists with .save() so the schema's
   * pre('validate') hook re-derives `geo` whenever lat/lng change.
   * findByIdAndUpdate would skip that hook and let lat/lng and geo drift.
   */
  async update(
    locationId: string,
    userId: string,
    dto: UpdateLocationDto,
  ): Promise<LocationDocument> {
    const location = await this.assertOwner(locationId, userId);

    const { name, lat, lng, url, metadata } = dto;
    if (name !== undefined) location.name = name;
    if (lat !== undefined) location.lat = lat;
    if (lng !== undefined) location.lng = lng;
    if (url !== undefined) location.url = url;
    if (metadata !== undefined) location.metadata = metadata;

    return location.save();
  }

  async remove(locationId: string, userId: string) {
    await this.assertOwner(locationId, userId);
    await this.locationModel.deleteOne({ _id: locationId });
    return { message: 'Location deleted' };
  }

  /**
   * Public ownership check used by other modules (e.g. GroupsService) to
   * enforce "you may only attach locations you own".
   */
  async assertOwnedBy(
    locationId: string,
    userId: string,
  ): Promise<LocationDocument> {
    return this.assertOwner(locationId, userId);
  }

  private async assertOwner(
    locationId: string,
    userId: string,
  ): Promise<LocationDocument> {
    const location = await this.locationModel.findById(locationId);
    if (!location) throw new NotFoundException('Location not found');
    if (location.createdBy.toString() !== userId) {
      throw new ForbiddenException('You do not own this location');
    }
    return location;
  }
}
