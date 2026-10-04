// src/groups/groups.service.cashier.spec.ts
//
// The cashier seat and the payment details it manages (Payment After Event).
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { GroupsService } from './groups.service';
import { Group } from './schemas/group.schema';
import { GroupMember } from './schemas/group-member.schema';
import { Message } from '../chat/schemas/message.schema';
import { Tournament } from '../tournaments/schemas/tournament.schema';
import { Location } from '../locations/schemas/location.schema';
import { ImageKitService } from '../common/upload/imagekit.service';
import { LocationsService } from '../locations/locations.service';
import { EventsService } from '../events/events.service';
import { PhotosService } from '../photos/photos.service';
import { SportTypesService } from '../sport-types/sport-types.service';
import { PlansService } from '../plans/plans.service';
import {
  plansDouble,
  sportTypesDouble,
} from '../events/events.test-providers';

const GROUP_ID = '507f1f77bcf86cd799439021';
const OWNER = '507f191e810c19729de860f1';
const CASHIER = '507f191e810c19729de860f2';
const MEMBER = '507f191e810c19729de860f3';
const STRANGER = '507f191e810c19729de860f4';

describe('GroupsService — cashier & payment details', () => {
  let service: GroupsService;
  const groupModel: any = {};
  const memberModel: any = {};
  const imagekit = {
    upload: jest.fn().mockResolvedValue({ url: 'https://ik/qr.png', fileId: 'qr1' }),
    deleteFile: jest.fn().mockResolvedValue(undefined),
  };

  const chain = (result: any) => ({
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
  });

  const groupRow = (over: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(GROUP_ID),
    ownerId: new Types.ObjectId(OWNER),
    cashierId: new Types.ObjectId(CASHIER),
    paymentDetails: null,
    ...over,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    imagekit.upload.mockResolvedValue({ url: 'https://ik/qr.png', fileId: 'qr1' });
    groupModel.findById = jest.fn().mockReturnValue(chain(groupRow()));
    groupModel.findByIdAndUpdate = jest
      .fn()
      .mockReturnValue(chain(groupRow({ paymentDetails: {} })));
    memberModel.findOne = jest.fn().mockResolvedValue({ status: 'approved' });

    const m = await Test.createTestingModule({
      providers: [
        GroupsService,
        { provide: getModelToken(Group.name), useValue: groupModel },
        { provide: getModelToken(GroupMember.name), useValue: memberModel },
        { provide: ImageKitService, useValue: imagekit },
        { provide: LocationsService, useValue: {} },
        { provide: getModelToken(Message.name), useValue: {} },
        { provide: getModelToken(Tournament.name), useValue: {} },
        { provide: getModelToken(Location.name), useValue: {} },
        { provide: EventsService, useValue: {} },
        { provide: PhotosService, useValue: {} },
        { provide: SportTypesService, useValue: sportTypesDouble() },
        { provide: PlansService, useValue: plansDouble() },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();
    service = m.get(GroupsService);
  });

  describe('setCashier — owner only, one per group', () => {
    it('404s an unknown group', async () => {
      groupModel.findById.mockReturnValue(chain(null));
      await expect(
        service.setCashier(GROUP_ID, OWNER, MEMBER),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('403s everyone but the owner — the current cashier included', async () => {
      await expect(
        service.setCashier(GROUP_ID, CASHIER, MEMBER),
      ).rejects.toThrow(/Only the group owner/);
      expect(groupModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('requires the appointee to be an approved member', async () => {
      memberModel.findOne.mockResolvedValue(null);
      await expect(
        service.setCashier(GROUP_ID, OWNER, STRANGER),
      ).rejects.toThrow(/approved member/);
      // The gate asked for approved membership specifically.
      expect(memberModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'approved' }),
      );
    });

    it('lets the owner appoint THEMSELF without a membership lookup', async () => {
      // The yaml rule: the owner can be cashier, but has to grant himself.
      await expect(
        service.setCashier(GROUP_ID, OWNER, OWNER),
      ).resolves.toMatchObject({ cashierId: OWNER });
      expect(memberModel.findOne).not.toHaveBeenCalled();
    });

    it('persists the appointment', async () => {
      await service.setCashier(GROUP_ID, OWNER, MEMBER);
      const [, update] = groupModel.findByIdAndUpdate.mock.calls[0];
      expect(update.$set.cashierId.toString()).toBe(MEMBER);
    });

    it('null clears the seat', async () => {
      const res = await service.setCashier(GROUP_ID, OWNER, null);
      const [, update] = groupModel.findByIdAndUpdate.mock.calls[0];
      expect(update.$set.cashierId).toBeNull();
      expect(res.message).toBe('Cashier removed');
    });
  });

  describe('payment details — cashier writes, members read', () => {
    const DTO = { bankAccountNumber: '0123456789', bankName: 'KBZ' } as any;

    it('403s a non-cashier write — even the owner', async () => {
      await expect(
        service.updatePaymentDetails(GROUP_ID, OWNER, DTO),
      ).rejects.toThrow(/Only the group cashier/);
    });

    it('403s every write while no cashier is appointed', async () => {
      groupModel.findById.mockReturnValue(chain(groupRow({ cashierId: null })));
      await expect(
        service.updatePaymentDetails(GROUP_ID, CASHIER, DTO),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('cashier sets the account; the QR fields survive', async () => {
      groupModel.findById.mockReturnValue(
        chain(
          groupRow({
            paymentDetails: {
              bankAccountNumber: 'old',
              bankName: null,
              accountHolderName: null,
              qrCodeUrl: 'https://ik/qr-old.png',
              qrCodeFileId: 'qrOld',
            },
          }),
        ),
      );

      await service.updatePaymentDetails(GROUP_ID, CASHIER, DTO);

      const [, update] = groupModel.findByIdAndUpdate.mock.calls[0];
      expect(update.$set.paymentDetails).toMatchObject({
        bankAccountNumber: '0123456789',
        bankName: 'KBZ',
        qrCodeUrl: 'https://ik/qr-old.png',
        qrCodeFileId: 'qrOld',
      });
    });

    it('members read the details; strangers do not', async () => {
      await expect(
        service.getPaymentDetails(GROUP_ID, MEMBER),
      ).resolves.toBeDefined();

      memberModel.findOne.mockResolvedValue(null);
      await expect(
        service.getPaymentDetails(GROUP_ID, STRANGER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('the owner reads without a membership row', async () => {
      memberModel.findOne.mockResolvedValue(null);
      await expect(
        service.getPaymentDetails(GROUP_ID, OWNER),
      ).resolves.toMatchObject({ cashierId: expect.anything() });
    });
  });

  describe('findById → isCashier on group detail', () => {
    beforeEach(() => {
      // findById reads the member row through a select/lean chain.
      memberModel.findOne = jest
        .fn()
        .mockReturnValue(chain({ role: 'member', status: 'approved' }));
    });

    it('is true for the cashier', async () => {
      const res: any = await service.findById(GROUP_ID, CASHIER);
      expect(res.isCashier).toBe(true);
    });

    it('is false for everyone else — the owner included', async () => {
      const res: any = await service.findById(GROUP_ID, OWNER);
      expect(res.isCashier).toBe(false);
    });

    it('is false while no cashier is appointed', async () => {
      groupModel.findById.mockReturnValue(chain(groupRow({ cashierId: null })));
      const res: any = await service.findById(GROUP_ID, CASHIER);
      expect(res.isCashier).toBe(false);
    });

    it('is false — never undefined — without a caller', async () => {
      const res: any = await service.findById(GROUP_ID);
      expect(res.isCashier).toBe(false);
    });
  });

  describe('uploadPaymentQr', () => {
    const file = { buffer: Buffer.from('qr') } as Express.Multer.File;

    it('cashier only', async () => {
      await expect(
        service.uploadPaymentQr(GROUP_ID, OWNER, file),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(imagekit.upload).not.toHaveBeenCalled();
    });

    it('uploads and persists url + fileId', async () => {
      await service.uploadPaymentQr(GROUP_ID, CASHIER, file);

      expect(imagekit.upload).toHaveBeenCalledWith(
        file.buffer,
        expect.stringContaining(GROUP_ID),
        'payment-qr',
      );
      const [, update] = groupModel.findByIdAndUpdate.mock.calls[0];
      expect(update.$set.paymentDetails).toMatchObject({
        qrCodeUrl: 'https://ik/qr.png',
        qrCodeFileId: 'qr1',
      });
    });

    it('replacing deletes the previous file AFTER the new upload', async () => {
      groupModel.findById.mockReturnValue(
        chain(
          groupRow({
            paymentDetails: {
              bankAccountNumber: '0123456789',
              bankName: null,
              accountHolderName: null,
              qrCodeUrl: 'https://ik/qr-old.png',
              qrCodeFileId: 'qrOld',
            },
          }),
        ),
      );

      await service.uploadPaymentQr(GROUP_ID, CASHIER, file);

      expect(imagekit.deleteFile).toHaveBeenCalledWith('qrOld');
      // The account fields survive the QR replacement.
      const [, update] = groupModel.findByIdAndUpdate.mock.calls[0];
      expect(update.$set.paymentDetails.bankAccountNumber).toBe('0123456789');
    });
  });
});
