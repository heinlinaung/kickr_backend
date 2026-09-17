// src/events/events.test-providers.ts
/**
 * Shared provider list for EventsService unit tests.
 *
 * EventsService now depends on eight models plus three services. Spelling that
 * out in every spec meant a new dependency broke four unrelated files at once,
 * so the wiring lives here and each spec passes only the doubles it cares
 * about — anything omitted falls back to an empty object.
 *
 * Test-only helper: not imported by any runtime module.
 */
import { getModelToken } from '@nestjs/mongoose';
import { Event } from './schemas/event.schema';
import { EventPlayer } from './schemas/event-player.schema';
import { EventMatch } from './schemas/event-match.schema';
import { Team } from './schemas/team.schema';
import { EventTeamChat } from './schemas/event-team-chat.schema';
import { EventLike } from './schemas/event-like.schema';
import { EventTemplate } from './schemas/event-template.schema';
import { EventPayment } from './schemas/event-payment.schema';
import { GroupMember } from '../groups/schemas/group-member.schema';
import { Group } from '../groups/schemas/group.schema';
import { Location } from '../locations/schemas/location.schema';
import { LocationsService } from '../locations/locations.service';
import { ImageKitService } from '../common/upload/imagekit.service';
import { PhotosService } from '../photos/photos.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SportTypesService } from '../sport-types/sport-types.service';
import { BadRequestException } from '@nestjs/common';

/**
 * Mirror of `scripts/seed-sport-types.ts`, so the default double validates
 * exactly like a seeded database and specs can assert real rejections
 * (unknown sport, subType on a sport with no formats) without wiring a mock.
 */
export const TEST_SPORT_TYPES = [
  { value: 'football', subTypes: ['futsal', 'stadium'], sortOrder: 1 },
  { value: 'futsal', subTypes: [], sortOrder: 2 },
  { value: 'badminton', subTypes: [], sortOrder: 3 },
  { value: 'padel', subTypes: [], sortOrder: 4 },
  { value: 'basketball', subTypes: [], sortOrder: 5 },
];

/** Behavioural double of SportTypesService over TEST_SPORT_TYPES. */
export function sportTypesDouble() {
  return {
    findAll: jest.fn().mockResolvedValue(TEST_SPORT_TYPES),
    findByValue: jest.fn(
      async (value: string) =>
        TEST_SPORT_TYPES.find((row) => row.value === value) ?? null,
    ),
    // Same messages as the real SportTypesService, so message-matching
    // assertions exercise the text callers actually see.
    assertValid: jest.fn(async (sportType: string, subType?: string | null) => {
      const sport = TEST_SPORT_TYPES.find((row) => row.value === sportType);
      if (!sport) {
        const valid = TEST_SPORT_TYPES.map((row) => row.value).join(', ');
        throw new BadRequestException(
          `Unknown sportType '${sportType}'. Valid values: ${valid}`,
        );
      }
      if (!subType) return;
      if (!sport.subTypes.includes(subType)) {
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
    }),
  };
}

export interface EventsTestDoubles {
  eventModel?: any;
  playerModel?: any;
  memberModel?: any;
  groupModel?: any;
  matchModel?: any;
  teamModel?: any;
  teamChatModel?: any;
  likeModel?: any;
  templateModel?: any;
  paymentModel?: any;
  locationModel?: any;
  locations?: any;
  imagekit?: any;
  photosService?: any;
  notifications?: any;
  sportTypes?: any;
}

export function eventsProviders(doubles: EventsTestDoubles = {}) {
  const {
    eventModel = {},
    // list() and listJoined() both resolve the caller's roster first, so the
    // default double has to answer a find().select().lean() chain.
    playerModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      }),
    },
    memberModel = {},
    groupModel = {},
    // findById/standings always query fixtures now, so the default double has
    // to answer a full find().sort().lean() chain with an empty list.
    matchModel = {
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      }),
    },
    // findById lists an event's teams, so the default must answer a full
    // find().populate().sort().lean() chain with an empty list.
    teamModel = {
      find: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      }),
    },
    teamChatModel = {},
    likeModel = {},
    templateModel = {},
    paymentModel = {},
    locationModel = {},
    locations = { assertOwnedBy: jest.fn(), assertCanEdit: jest.fn() },
    imagekit = { upload: jest.fn(), deleteFile: jest.fn() },
    // Event photos now live in the shared `photos` collection, so the service
    // delegates instead of mutating event.photos. Defaults resolve to an empty
    // gallery, which is what the add/remove callers assert against.
    photosService = {
      add: jest.fn().mockResolvedValue({ photos: [] }),
      remove: jest.fn().mockResolvedValue({ photos: [] }),
      list: jest.fn().mockResolvedValue({ photos: [] }),
      removeAllForTarget: jest.fn().mockResolvedValue({ photos: 0 }),
    },
    notifications = { create: jest.fn().mockResolvedValue(undefined) },
    sportTypes = sportTypesDouble(),
  } = doubles;

  return [
    { provide: getModelToken(Event.name), useValue: eventModel },
    { provide: getModelToken(EventPlayer.name), useValue: playerModel },
    { provide: getModelToken(GroupMember.name), useValue: memberModel },
    { provide: getModelToken(Group.name), useValue: groupModel },
    { provide: getModelToken(EventMatch.name), useValue: matchModel },
    { provide: getModelToken(Team.name), useValue: teamModel },
    { provide: getModelToken(EventTeamChat.name), useValue: teamChatModel },
    { provide: getModelToken(EventLike.name), useValue: likeModel },
    { provide: getModelToken(EventTemplate.name), useValue: templateModel },
    { provide: getModelToken(EventPayment.name), useValue: paymentModel },
    { provide: getModelToken(Location.name), useValue: locationModel },
    { provide: LocationsService, useValue: locations },
    { provide: ImageKitService, useValue: imagekit },
    { provide: PhotosService, useValue: photosService },
    { provide: NotificationsService, useValue: notifications },
    { provide: SportTypesService, useValue: sportTypes },
  ];
}
