// src/sport-types/sport-types.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SportType, SportTypeDocument } from './schemas/sport-type.schema';
import { Group, GroupDocument } from '../groups/schemas/group.schema';
import { Event, EventDocument } from '../events/schemas/event.schema';
import {
  EventTemplate,
  EventTemplateDocument,
} from '../events/schemas/event-template.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateSportTypeDto } from './dto/create-sport-type.dto';
import { UpdateSportTypeDto } from './dto/update-sport-type.dto';

const PUBLIC_FIELDS = 'value name subTypes sortOrder matchProvided';

@Injectable()
export class SportTypesService {
  constructor(
    @InjectModel(SportType.name)
    private sportTypeModel: Model<SportTypeDocument>,
    @InjectModel(Group.name)
    private groupModel: Model<GroupDocument>,
    @InjectModel(Event.name)
    private eventModel: Model<EventDocument>,
    @InjectModel(EventTemplate.name)
    private templateModel: Model<EventTemplateDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
  ) {}

  /**
   * The whole list, in display order.
   *
   * Deliberately unpaginated: a fixed reference list of a handful of sports
   * that a client renders as a single picker, same reasoning as
   * `GlobalFootballTeamsService.findAll`.
   */
  async findAll() {
    const rows = await this.sportTypeModel
      .find()
      .select(PUBLIC_FIELDS)
      .sort({ sortOrder: 1, value: 1 })
      .lean();
    return rows.map(withDefaults);
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

  // --- Admin writes ------------------------------------------------------
  //
  // Guarded by SuperadminGuard in the controller: this is reference data that
  // every group/event/user write validates against, not something end users
  // own. Groups, events and users store `value` itself — the sport's ID — so
  // it never changes; a rename touches the display `name` only.

  /** One sport by value for the API: 404 instead of null. */
  async findOne(value: string) {
    const sport = await this.sportTypeModel
      .findOne({ value: value.toLowerCase() })
      .select(PUBLIC_FIELDS)
      .lean();
    if (!sport) throw new NotFoundException(`Sport type '${value}' not found`);
    return withDefaults(sport);
  }

  async create(dto: CreateSportTypeDto) {
    if (await this.sportTypeModel.exists({ value: dto.value })) {
      throw new ConflictException(`Sport type '${dto.value}' already exists`);
    }
    const name = dto.name ?? dto.value;
    await this.assertNameFree(name);

    // Omitted sortOrder appends: one past the current last row.
    let sortOrder = dto.sortOrder;
    if (sortOrder === undefined) {
      const last = await this.sportTypeModel
        .findOne()
        .sort({ sortOrder: -1 })
        .select('sortOrder')
        .lean();
      sortOrder = (last?.sortOrder ?? 0) + 1;
    }

    const created = await this.sportTypeModel.create({
      value: dto.value,
      name,
      subTypes: unique(dto.subTypes ?? []),
      sortOrder,
      matchProvided: dto.matchProvided ?? true,
    });
    return this.findOne(created.value);
  }

  /**
   * Updates `name`, `sortOrder` and/or `matchProvided`. `value` is the ID
   * other documents store and never changes, so a rename is a single write.
   * SubTypes are changed through the dedicated sub-type methods below.
   */
  async update(value: string, dto: UpdateSportTypeDto) {
    const sport = await this.findOne(value);

    const $set: Partial<SportType> = {};
    if (dto.sortOrder !== undefined) $set.sortOrder = dto.sortOrder;
    if (dto.matchProvided !== undefined) {
      $set.matchProvided = dto.matchProvided;
    }
    if (dto.name !== undefined && dto.name !== sport.name) {
      await this.assertNameFree(dto.name, sport.value);
      $set.name = dto.name;
    }

    if (Object.keys($set).length) {
      await this.sportTypeModel.updateOne({ value: sport.value }, { $set });
    }
    return this.findOne(sport.value);
  }

  /**
   * Deletes a sport. Without `replaceWith`, refused while anything still
   * stores its value. With it, every holder is moved to that sport first,
   * e.g. futsal → football.
   */
  async remove(value: string, replaceWith?: string) {
    const sport = await this.findOne(value);
    if (replaceWith === undefined) {
      await this.assertSportUnused(sport.value);
    } else {
      if (replaceWith === sport.value) {
        throw new BadRequestException(
          `replaceWith must differ from the sport type being deleted`,
        );
      }
      const target = await this.sportTypeModel
        .findOne({ value: replaceWith })
        .select(PUBLIC_FIELDS)
        .lean();
      if (!target) {
        throw new BadRequestException(
          `replaceWith sport type '${replaceWith}' not found`,
        );
      }
      await this.reassignSport(sport.value, target);
    }
    await this.sportTypeModel.deleteOne({ value: sport.value });
    return replaceWith === undefined
      ? { deleted: true, value: sport.value }
      : { deleted: true, value: sport.value, replacedWith: replaceWith };
  }

  /**
   * Moves every group, event, template and user profile from sport `from` to
   * `to`. Each step is idempotent and the sport row is deleted only after,
   * so a failed request can simply be retried.
   *
   * An event's subType must be valid for its new sport: when `to` lists
   * `from` as a format (football lists 'futsal'), moved events and templates
   * take that format; otherwise a subType `to` does not list is cleared.
   */
  private async reassignSport(
    from: string,
    to: { value: string; subTypes: string[] },
  ) {
    const scoped = { sportType: from };
    const eventsAndTemplates = [this.eventModel, this.templateModel] as Model<
      EventDocument | EventTemplateDocument
    >[];
    if (to.subTypes.includes(from)) {
      await Promise.all(
        eventsAndTemplates.map((m) =>
          m.updateMany(scoped, {
            $set: { sportType: to.value, subType: from },
          }),
        ),
      );
    } else {
      await Promise.all(
        eventsAndTemplates.map((m) =>
          m.updateMany(
            { ...scoped, subType: { $nin: [...to.subTypes, null] } },
            { $set: { subType: null } },
          ),
        ),
      );
      await Promise.all(
        eventsAndTemplates.map((m) =>
          m.updateMany(scoped, { $set: { sportType: to.value } }),
        ),
      );
    }

    await this.groupModel.updateMany(scoped, {
      $set: { sportType: to.value },
    });

    // User arrays: drop `from` where `to` is already listed, else swap it in
    // place so the user's ordering is kept.
    for (const field of ['sports', 'preferredSport'] as const) {
      await this.userModel.updateMany(
        { [field]: { $all: [from, to.value] } },
        { $pull: { [field]: from } },
      );
      await this.userModel.updateMany(
        { [field]: from },
        { $set: { [`${field}.$`]: to.value } },
      );
    }
  }

  /**
   * 409 when another sport already has this display name, ignoring case —
   * 'Football' and 'football' would be indistinguishable in a picker.
   * `except` is the sport being renamed, so changing only its case is allowed.
   */
  private async assertNameFree(name: string, except?: string) {
    const taken = await this.sportTypeModel.exists({
      name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' },
      ...(except && { value: { $ne: except } }),
    });
    if (taken) {
      throw new ConflictException(`Sport type name '${name}' already exists`);
    }
  }

  /** Adds one format to a sport, e.g. 'beach' to football. A duplicate is a 409. */
  async addSubType(value: string, subType: string) {
    const sport = await this.findOne(value);
    if (sport.subTypes.includes(subType)) {
      throw new ConflictException(
        `subType '${subType}' already exists on sport type '${sport.value}'`,
      );
    }
    // $addToSet as well as the check above, so two concurrent adds of the
    // same subType cannot produce a duplicate entry.
    await this.sportTypeModel.updateOne(
      { value: sport.value },
      { $addToSet: { subTypes: subType } },
    );
    return this.findOne(sport.value);
  }

  /**
   * Renames one format in place, e.g. football's 'stadium' → 'eleven-a-side',
   * keeping its position in the list. Unlike a sport `value`, a subType can be
   * renamed: only events and templates of this one sport store it, so they are
   * moved to the new name rather than stranded.
   *
   * Events and templates move first, the sport row last: if a step fails, the
   * old name is still listed, so the same request can simply be retried.
   */
  async renameSubType(value: string, subType: string, next: string) {
    const sport = await this.findOne(value);
    const current = subType.trim().toLowerCase();
    if (!sport.subTypes.includes(current)) {
      throw new NotFoundException(
        `subType '${subType}' not found on sport type '${sport.value}'`,
      );
    }
    if (next === current) return sport;
    if (sport.subTypes.includes(next)) {
      throw new ConflictException(
        `subType '${next}' already exists on sport type '${sport.value}'`,
      );
    }

    const filter = { sportType: sport.value, subType: current };
    await Promise.all([
      this.eventModel.updateMany(filter, { $set: { subType: next } }),
      this.templateModel.updateMany(filter, { $set: { subType: next } }),
    ]);
    await this.sportTypeModel.updateOne(
      { value: sport.value, subTypes: current },
      { $set: { 'subTypes.$': next } },
    );
    return this.findOne(sport.value);
  }

  /**
   * Re-sorts a sport's formats, e.g. football's ['futsal', 'stadium'] →
   * ['stadium', 'futsal']. The list must hold exactly the current subTypes —
   * adding, dropping and renaming have their own routes with their own
   * in-use checks, so a reorder never touches events or templates.
   */
  async reorderSubTypes(value: string, order: string[]) {
    const sport = await this.findOne(value);
    const missing = sport.subTypes.filter((st) => !order.includes(st));
    const unknown = order.filter((st) => !sport.subTypes.includes(st));
    if (
      missing.length ||
      unknown.length ||
      order.length !== sport.subTypes.length
    ) {
      throw new BadRequestException(
        `subTypes must list each of '${sport.value}'s current subTypes ` +
          `exactly once: ${sport.subTypes.join(', ')}`,
      );
    }
    await this.sportTypeModel.updateOne(
      { value: sport.value },
      { $set: { subTypes: order } },
    );
    return this.findOne(sport.value);
  }

  /** Removes one format from a sport — refused while an event or template uses it. */
  async removeSubType(value: string, subType: string) {
    const sport = await this.findOne(value);
    const normalised = subType.trim().toLowerCase();
    if (!sport.subTypes.includes(normalised)) {
      throw new NotFoundException(
        `subType '${subType}' not found on sport type '${sport.value}'`,
      );
    }
    await this.assertSubTypeUnused(sport.value, normalised);
    await this.sportTypeModel.updateOne(
      { value: sport.value },
      { $pull: { subTypes: normalised } },
    );
    return this.findOne(sport.value);
  }

  /**
   * Deleting a sport still stored somewhere would make those documents fail
   * validation on their next sportType write (see the seed script's note on
   * why it never deletes). Counts each holder so the message says what to fix.
   */
  private async assertSportUnused(value: string) {
    const [groups, events, templates, users] = await Promise.all([
      this.groupModel.countDocuments({ sportType: value }),
      this.eventModel.countDocuments({ sportType: value }),
      this.templateModel.countDocuments({ sportType: value }),
      this.userModel.countDocuments({
        $or: [{ sports: value }, { preferredSport: value }],
      }),
    ]);
    const usage = describeUsage({ groups, events, templates, users });
    if (usage) {
      throw new ConflictException(
        `Sport type '${value}' is still in use (${usage})`,
      );
    }
  }

  private async assertSubTypeUnused(sportType: string, subType: string) {
    const [events, templates] = await Promise.all([
      this.eventModel.countDocuments({ sportType, subType }),
      this.templateModel.countDocuments({ sportType, subType }),
    ]);
    const usage = describeUsage({ events, templates });
    if (usage) {
      throw new ConflictException(
        `subType '${subType}' of sport type '${sportType}' is still in use ` +
          `(${usage})`,
      );
    }
  }
}

/**
 * `.lean()` skips schema defaults, so a row stored before `matchProvided` or
 * `name` existed would read them as undefined. Every such row is a match
 * sport, and is labelled by its value until a name is set.
 */
function withDefaults<
  T extends { value: string; name?: string; matchProvided?: boolean },
>(row: T): T & { name: string; matchProvided: boolean } {
  return {
    ...row,
    name: row.name ?? row.value,
    matchProvided: row.matchProvided ?? true,
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Order-preserving dedupe. */
function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** "3 groups, 1 events" — only the non-zero counts; '' when unused. */
function describeUsage(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([what, n]) => `${n} ${what}`)
    .join(', ');
}
