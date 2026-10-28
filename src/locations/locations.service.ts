import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Location, LocationDocument } from './schemas/location.schema';
import {
  GroupMember,
  GroupMemberDocument,
} from '../groups/schemas/group-member.schema';
import { Group, GroupDocument } from '../groups/schemas/group.schema';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

/**
 * Group roles allowed to EDIT a group-owned location's details.
 *
 * `vice-captain` mirrors `captain` deliberately: a deputy that cannot do what
 * the captain does would be surprising, and editing a venue is reversible.
 *
 * `referee` is deliberately ABSENT. The role does carry one permission —
 * entering match scores — but venues are not its business. Its omission here
 * is a decision, not an oversight.
 */
const EDIT_ROLES = ['owner', 'admin', 'captain', 'vice-captain'];
/** Group roles allowed to DELETE a group-owned location (structural change). */
const DELETE_ROLES = ['owner', 'admin'];
/** Group roles allowed to CREATE a location under a group. */
const CREATE_ROLES = DELETE_ROLES;

export const MAX_GROUP_LOCATIONS = 5;

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
    @InjectModel(Group.name)
    private groupModel: Model<GroupDocument>,
  ) {}

  /**
   * Locations are creator-owned, not a shared registry: this ALWAYS inserts a
   * new row. Two users adding the same pitch intentionally produce two rows,
   * so there is deliberately no name/proximity dedupe lookup here.
   *
   * Internal: `groupId` is trusted, so the caller must do its own gating
   * (see createForGroup).
   */
  async create(
    userId: string,
    dto: CreateLocationDto,
    groupId?: string,
  ): Promise<LocationDocument> {
    return this.locationModel.create({
      ...dto,
      createdBy: new Types.ObjectId(userId),
      // When owned by a group, that group's owner/admin/captain can manage it
      // (not just the creator).
      groupId: groupId ? new Types.ObjectId(groupId) : null,
    });
  }

  /**
   * Transfers still-personal locations to a group that has just adopted them.
   *
   * Supports creating a group with `locationIds`: once the group is created
   * with those ids, the group takes ownership so its owner/admin/captain can
   * maintain them.
   *
   * Only rows that are still personal (`groupId: null`) AND created by this
   * user are adopted — a location already owned by another group is left
   * alone rather than silently reassigned.
   */
  async adoptPersonalLocations(
    locationIds: Types.ObjectId[],
    userId: string,
    groupId: string,
  ): Promise<void> {
    if (!locationIds.length) return;
    await this.locationModel.updateMany(
      {
        _id: { $in: locationIds },
        createdBy: new Types.ObjectId(userId),
        // Only adopt rows that are still unclaimed. A location already owned by
        // a group is SKIPPED, never reassigned — otherwise creating a group
        // could quietly steal another group's venue.
        // In MongoDB `field: null` also matches documents where the field is
        // absent, so this covers rows written before `groupId` existed.
        groupId: null,
      },
      { $set: { groupId: new Types.ObjectId(groupId) } },
    );
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
    return this.applyUpdate(location, dto);
  }

  private applyUpdate(
    location: LocationDocument,
    dto: UpdateLocationDto,
  ): Promise<LocationDocument> {
    const { name, lat, lng, url, metadata } = dto;
    if (name !== undefined) location.name = name;
    if (lat !== undefined) location.lat = lat;
    if (lng !== undefined) location.lng = lng;
    if (url !== undefined) location.url = url;
    if (metadata !== undefined) location.metadata = metadata;

    return location.save();
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

  // ------------------------------------------- /groups/:groupId/locations

  /** The group's locations, populated. Readable by any authenticated user. */
  async listForGroup(groupId: string) {
    const group = await this.groupModel
      .findById(groupId)
      .populate('locations')
      .lean();
    if (!group) throw new NotFoundException('Group not found');
    return (group as any).locations ?? [];
  }

  async findForGroup(groupId: string, locationId: string) {
    const location = await this.locationModel.findById(locationId).lean();
    if (!location || !(await this.belongsToGroup(groupId, location))) {
      throw new NotFoundException('Location not found in this group');
    }
    return location;
  }

  /**
   * Owner/admin only. Creates a location owned by the group and attaches it to
   * `Group.locations`, capped at MAX_GROUP_LOCATIONS.
   */
  async createForGroup(
    groupId: string,
    userId: string,
    dto: CreateLocationDto,
  ): Promise<LocationDocument> {
    await this.assertGroupRole(groupId, userId, CREATE_ROLES);

    const group = await this.groupModel
      .findById(groupId)
      .select('locations')
      .lean();
    if (!group) throw new NotFoundException('Group not found');
    if ((group.locations ?? []).length >= MAX_GROUP_LOCATIONS) {
      throw new BadRequestException(
        `A group may have at most ${MAX_GROUP_LOCATIONS} locations`,
      );
    }

    const location = await this.create(userId, dto, groupId);

    // Re-check the cap atomically: a concurrent create may have filled the
    // last slot since the count above.
    const attached = await this.groupModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(groupId),
        [`locations.${MAX_GROUP_LOCATIONS - 1}`]: { $exists: false },
      },
      { $addToSet: { locations: location._id } },
    );
    if (!attached) {
      await this.locationModel.deleteOne({ _id: location._id });
      throw new BadRequestException(
        `A group may have at most ${MAX_GROUP_LOCATIONS} locations`,
      );
    }
    return location;
  }

  /**
   * Owner/admin/captain/vice-captain. Only locations OWNED by this group are
   * editable here; one merely attached to it belongs to someone else.
   */
  async updateForGroup(
    groupId: string,
    locationId: string,
    userId: string,
    dto: UpdateLocationDto,
  ): Promise<LocationDocument> {
    await this.assertGroupRole(groupId, userId, EDIT_ROLES);
    const location = await this.loadForGroup(groupId, locationId);
    if (location.groupId?.toString() !== groupId) {
      throw new ForbiddenException(
        'This location is attached to the group but owned elsewhere',
      );
    }
    return this.applyUpdate(location, dto);
  }

  /**
   * Owner/admin only. A location owned by the group is deleted outright (and
   * pulled from every group referencing it); one merely attached is only
   * detached from this group, since the row is not the group's to delete.
   */
  async removeForGroup(groupId: string, locationId: string, userId: string) {
    await this.assertGroupRole(groupId, userId, DELETE_ROLES);
    const location = await this.loadForGroup(groupId, locationId);
    const id = location._id;

    if (location.groupId?.toString() !== groupId) {
      await this.groupModel.updateOne(
        { _id: new Types.ObjectId(groupId) },
        { $pull: { locations: id } },
      );
      return { message: 'Location detached' };
    }

    await this.locationModel.deleteOne({ _id: id });
    // Also drop the reference from any group holding it, otherwise the stale id
    // lingers in `Group.locations` — invisible in the populated list but still
    // counting toward the location cap.
    await this.groupModel.updateMany(
      { locations: id },
      { $pull: { locations: id } },
    );
    return { message: 'Location deleted' };
  }

  private async loadForGroup(
    groupId: string,
    locationId: string,
  ): Promise<LocationDocument> {
    const location = await this.locationModel.findById(locationId);
    if (!location || !(await this.belongsToGroup(groupId, location))) {
      throw new NotFoundException('Location not found in this group');
    }
    return location;
  }

  /** Owned by the group, or attached to its `locations` list. */
  private async belongsToGroup(
    groupId: string,
    location: { _id: Types.ObjectId; groupId?: Types.ObjectId | null },
  ): Promise<boolean> {
    if (location.groupId?.toString() === groupId) return true;
    const attached = await this.groupModel.exists({
      _id: new Types.ObjectId(groupId),
      locations: location._id,
    });
    return !!attached;
  }

  private async assertGroupRole(
    groupId: string,
    userId: string,
    allowedRoles: string[],
  ) {
    const member = await this.memberModel.findOne({
      groupId: new Types.ObjectId(groupId),
      userId: new Types.ObjectId(userId),
      status: 'approved',
      role: { $in: allowedRoles },
    });
    if (!member) {
      throw new ForbiddenException(
        "You do not have permission to manage this group's locations",
      );
    }
  }
}
