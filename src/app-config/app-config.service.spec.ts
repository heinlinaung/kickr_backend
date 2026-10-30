import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AppConfigService, compareVersions } from './app-config.service';
import { AppConfig } from './schemas/app-config.schema';

const USER_ID = '507f1f77bcf86cd799439011';

const platformUpdate = {
  latestVersion: '1.0.1',
  minimumVersion: '1.0.0',
  upgradeTitle: 'A new version is available',
  upgradeDescription: 'Please update.',
  forceUpdate: false,
};
const platformMajor = {
  enabled: true,
  title: 'Major Update Available',
  description: 'Please update.',
  version: '1.0.0',
};
const CONFIG = {
  appUpdate: { ios: { ...platformUpdate }, android: { ...platformUpdate } },
  majorUpdate: { ios: { ...platformMajor }, android: { ...platformMajor } },
};

describe('AppConfigService', () => {
  let service: AppConfigService;
  let rows: any[];
  const model: any = {};

  /** findOne().sort().select().lean() — answers from `rows`. */
  const chain = (resolve: () => any) => ({
    sort: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn(async () => resolve()),
  });

  const latest = () =>
    rows.length
      ? rows.reduce((a, b) => (b.revision > a.revision ? b : a))
      : null;

  beforeEach(async () => {
    rows = [];
    model.findOne = jest.fn((filter: any = {}) =>
      chain(() =>
        filter.revision !== undefined
          ? (rows.find((r) => r.revision === filter.revision) ?? null)
          : latest(),
      ),
    );
    model.find = jest.fn(() => chain(() => [...rows].reverse()));
    model.create = jest.fn(async (doc: any) => {
      rows.push(doc);
      return doc;
    });

    const m = await Test.createTestingModule({
      providers: [
        AppConfigService,
        { provide: getModelToken(AppConfig.name), useValue: model },
      ],
    }).compile();
    service = m.get(AppConfigService);
  });

  describe('findLatest', () => {
    it('404s before anything is saved', async () => {
      await expect(service.findLatest()).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('saves revision 1, then 2, keeping the first', async () => {
      await service.create(CONFIG, USER_ID);
      await service.create(CONFIG, USER_ID);

      expect(rows.map((r) => r.revision)).toEqual([1, 2]);
      expect(String(rows[1].updatedBy)).toBe(USER_ID);
    });

    it('rejects minimumVersion above latestVersion', async () => {
      const bad = {
        ...CONFIG,
        appUpdate: {
          ...CONFIG.appUpdate,
          android: { ...platformUpdate, minimumVersion: '1.10.0' },
        },
      };
      await expect(service.create(bad as any, USER_ID)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(model.create).not.toHaveBeenCalled();
    });
  });

  describe('features', () => {
    it('defaults to every feature off', async () => {
      const out = await service.create(CONFIG, USER_ID);
      expect(out.features).toEqual({
        tournament: false,
        groupChallenge: false,
      });
    });

    it('PATCH merges flags', async () => {
      await service.create(
        { ...CONFIG, features: { tournament: true } },
        USER_ID,
      );
      const out = await service.update(
        { features: { groupChallenge: true } },
        USER_ID,
      );
      expect(out.features).toEqual({ tournament: true, groupChallenge: true });
    });

    it('reads revisions saved before the field existed as defaults', async () => {
      rows.push({ ...CONFIG, revision: 1 });
      const out = await service.findLatest();
      expect(out.features).toEqual({
        tournament: false,
        groupChallenge: false,
      });
    });
  });

  describe('update', () => {
    it('404s when there is no config to update', async () => {
      await expect(service.update({}, USER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('merges the sent fields into a new revision, leaving the old one intact', async () => {
      await service.create(CONFIG, USER_ID);

      const out = await service.update(
        { appUpdate: { ios: { latestVersion: '1.0.2', forceUpdate: true } } },
        USER_ID,
      );

      expect(out.revision).toBe(2);
      expect(out.appUpdate.ios).toEqual({
        ...platformUpdate,
        latestVersion: '1.0.2',
        forceUpdate: true,
      });
      expect(out.appUpdate.android).toEqual(platformUpdate);
      expect(out.majorUpdate).toEqual(CONFIG.majorUpdate);
      expect(out.features).toEqual({
        tournament: false,
        groupChallenge: false,
      });
      expect(rows[0].appUpdate.ios.latestVersion).toBe('1.0.1');
    });
  });

  describe('compareVersions', () => {
    it('compares numerically, part by part', () => {
      expect(compareVersions('1.10.0', '1.9.2')).toBe(1);
      expect(compareVersions('1.0', '1.0.0')).toBe(0);
      expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
    });
  });
});
