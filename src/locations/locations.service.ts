import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Location, LocationDocument } from './schemas/location.schema';
import {
  GroupMember,
  GroupMemberDocument,
} from '../groups/schemas/group-member.schema';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

/** Group roles allowed to EDIT a group-owned location's details. */
const EDIT_ROLES = ['owner', 'admin', 'captain'];
/** Group roles allowed to DELETE a group-owned location (structural change). */
const DELETE_ROLES = ['owner', 'admin'];

@Injectable()
export class LocationsService {
  constructor(
    @InjectModel(Location.name)
    private locationModel: Model<LocationDocument>,
    // The GroupMember model is injected directly rather than depending on
    // GroupsService: GroupsModule already imports LocationsModule, so going the
    // other way would create a circular module dependency.
    @InjectModel(GroupMember.name)
    private memberModel: Model<GroupMemberDocument>,
  ) {}

  /**
   * Locations are creator-owned, not a shared registry: this ALWAYS inserts a
   * new row. Two users adding the same pitch intentionally produce two rows,
   * so there is deliberately no name/proximity dedupe lookup here.
   */
  async create(
    userId: string,
    dto: CreateLocationDto,
    groupId?: string,
  ): Promise<LocationDocument> {
    return this.locationModel.create({
      ...dto,
      createdBy: new Types.ObjectId(userId),
      // When created in a group context the group owns it, so the group's
      // owner/admin/captain can manage it (not just the creator).
      groupId: groupId ? new Types.ObjectId(groupId) : null,
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
    return location;
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
    const location = await this.assertCanEdit(locationId, userId);

    const { name, lat, lng, url, metadata } = dto;
    if (name !== undefined) location.name = name;
    if (lat !== undefined) location.lat = lat;
    if (lng !== undefined) location.lng = lng;
    if (url !== undefined) location.url = url;
    if (metadata !== undefined) location.metadata = metadata;

    return location.save();
  }

  async remove(locationId: string, userId: string) {
    await this.assertCanDelete(locationId, userId);
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
    const location = await this.locationModel.findById(locationId);
    if (!location) throw new NotFoundException('Location not found');
    if (location.createdBy.toString() !== userId) {
      throw new ForbiddenException('You do not own this location');
    }
    return location;
  }

  /**
   * Editing details (name, pin, url, metadata).
   * Allowed for the creator, or — when the location belongs to a group — for
   * that group's owner/admin/captain.
   */
  async assertCanEdit(
    locationId: string,
    userId: string,
  ): Promise<LocationDocument> {
    return this.assertPermitted(locationId, userId, EDIT_ROLES);
  }

  /**
   * Deleting. Same as edit, minus captain: removing a venue the group relies on
   * is a structural change, so it stays with owner/admin.
   */
  async assertCanDelete(
    locationId: string,
    userId: string,
  ): Promise<LocationDocument> {
    return this.assertPermitted(locationId, userId, DELETE_ROLES);
  }

  private async assertPermitted(
    locationId: string,
    userId: string,
    allowedRoles: string[],
  ): Promise<LocationDocument> {
    const location = await this.locationModel.findById(locationId);
    if (!location) throw new NotFoundException('Location not found');

    // The creator always retains control of their own row.
    if (location.createdBy.toString() === userId) return location;

    // Personal locations (no owning group) are creator-only — deliberately do
    // not consult group membership here, so attaching a personal location to a
    // group never hands that group's staff edit rights over it.
    if (!location.groupId) {
      throw new ForbiddenException('You do not own this location');
    }

    const member = await this.memberModel.findOne({
      groupId: location.groupId,
      userId: new Types.ObjectId(userId),
      status: 'approved',
      role: { $in: allowedRoles },
    });
    if (!member) {
      throw new ForbiddenException(
        'You do not have permission to manage this location',
      );
    }
    return location;
  }
}
