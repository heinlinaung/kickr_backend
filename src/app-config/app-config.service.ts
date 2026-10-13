import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AppConfig,
  AppConfigDocument,
  AppUpdate,
  MajorUpdate,
} from './schemas/app-config.schema';
import {
  AppUpdateDto,
  CreateAppConfigDto,
  MajorUpdateDto,
} from './dto/create-app-config.dto';
import { UpdateAppConfigDto } from './dto/update-app-config.dto';

const PUBLIC_FIELDS = 'revision appUpdate majorUpdate createdAt -_id';
const ADMIN_FIELDS = 'revision appUpdate majorUpdate updatedBy createdAt -_id';

const PLATFORMS = ['ios', 'android'] as const;

/** Attempts at claiming the next revision before giving up with a 409. */
const MAX_WRITE_ATTEMPTS = 3;

@Injectable()
export class AppConfigService {
  constructor(
    @InjectModel(AppConfig.name)
    private appConfigModel: Model<AppConfigDocument>,
  ) {}

  /**
   * The live config — the highest revision. What the apps read at startup,
   * so it carries no admin-only fields.
   */
  async findLatest() {
    const latest = await this.appConfigModel
      .findOne()
      .sort({ revision: -1 })
      .select(PUBLIC_FIELDS)
      .lean();
    if (!latest) throw new NotFoundException('App config has not been set');
    return latest;
  }

  /**
   * Past and current revisions, newest first. Paged by revision number:
   * pass the last row's `revision` as `before` to get the next page.
   */
  async findHistory(limit = 20, before?: number) {
    const filter = before !== undefined ? { revision: { $lt: before } } : {};
    return this.appConfigModel
      .find(filter)
      .sort({ revision: -1 })
      .limit(limit)
      .select(ADMIN_FIELDS)
      .lean();
  }

  async findRevision(revision: number) {
    const row = await this.appConfigModel
      .findOne({ revision })
      .select(ADMIN_FIELDS)
      .lean();
    if (!row) {
      throw new NotFoundException(`App config revision ${revision} not found`);
    }
    return row;
  }

  // --- Admin writes ------------------------------------------------------
  //
  // Both writes INSERT a new revision; nothing is ever updated in place or
  // deleted, so the previous config stays in the history unchanged.

  /** Saves a complete config as the new latest revision. */
  async create(dto: CreateAppConfigDto, userId: string) {
    return this.insertRevision(
      {
        appUpdate: withAppUpdateDefaults(dto.appUpdate),
        majorUpdate: withMajorUpdateDefaults(dto.majorUpdate),
      },
      userId,
    );
  }

  /**
   * Applies only the fields sent on top of the current latest revision and
   * saves the result as a new revision — e.g. bumping iOS `latestVersion`
   * alone carries everything else over unchanged.
   */
  async update(dto: UpdateAppConfigDto, userId: string) {
    const current = await this.appConfigModel
      .findOne()
      .sort({ revision: -1 })
      .lean();
    if (!current) {
      throw new NotFoundException(
        'App config has not been set — create it first with POST /app-config',
      );
    }

    const appUpdate = { ...current.appUpdate };
    const majorUpdate = { ...current.majorUpdate };
    for (const platform of PLATFORMS) {
      appUpdate[platform] = {
        ...current.appUpdate[platform],
        ...defined(dto.appUpdate?.[platform]),
      };
      majorUpdate[platform] = {
        ...current.majorUpdate[platform],
        ...defined(dto.majorUpdate?.[platform]),
      };
    }

    return this.insertRevision({ appUpdate, majorUpdate }, userId);
  }

  private async insertRevision(
    config: { appUpdate: AppUpdate; majorUpdate: MajorUpdate },
    userId: string,
  ) {
    for (const platform of PLATFORMS) {
      const { latestVersion, minimumVersion } = config.appUpdate[platform];
      if (compareVersions(minimumVersion, latestVersion) > 0) {
        throw new BadRequestException(
          `appUpdate.${platform}.minimumVersion (${minimumVersion}) cannot be ` +
            `above latestVersion (${latestVersion})`,
        );
      }
    }

    // `revision` is unique: if a concurrent write took the number we picked,
    // the insert fails with a duplicate key and we try the next one.
    for (let attempt = 1; ; attempt++) {
      const last = await this.appConfigModel
        .findOne()
        .sort({ revision: -1 })
        .select('revision')
        .lean();
      const revision = (last?.revision ?? 0) + 1;
      try {
        await this.appConfigModel.create({
          ...config,
          revision,
          updatedBy: new Types.ObjectId(userId),
        });
        return this.findRevision(revision);
      } catch (err) {
        if ((err as { code?: number })?.code !== 11000) throw err;
        if (attempt >= MAX_WRITE_ATTEMPTS) {
          throw new ConflictException(
            'App config was changed by someone else at the same time — retry',
          );
        }
      }
    }
  }
}

function withAppUpdateDefaults(appUpdate: AppUpdateDto): AppUpdate {
  const out = { ...appUpdate } as AppUpdate;
  for (const platform of PLATFORMS) {
    out[platform] = {
      ...appUpdate[platform],
      forceUpdate: appUpdate[platform].forceUpdate ?? false,
    };
  }
  return out;
}

function withMajorUpdateDefaults(majorUpdate: MajorUpdateDto): MajorUpdate {
  const out = { ...majorUpdate } as MajorUpdate;
  for (const platform of PLATFORMS) {
    out[platform] = {
      ...majorUpdate[platform],
      enabled: majorUpdate[platform].enabled ?? false,
    };
  }
  return out;
}

/** Drops undefined keys so a spread does not blank out existing values. */
function defined<T extends object>(obj: T | undefined): Partial<T> {
  if (!obj) return {};
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

/** Numeric, part by part: '1.10.0' > '1.9.2', and '1.0' equals '1.0.0'. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}
