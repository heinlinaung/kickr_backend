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
import { NotificationsService } from '../notifications/notifications.service';

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
  notifications?: any;
}

export function eventsProviders(doubles: EventsTestDoubles = {}) {
  const {
    eventModel = {},
    playerModel = {},
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
    notifications = { create: jest.fn().mockResolvedValue(undefined) },
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
    { provide: NotificationsService, useValue: notifications },
  ];
}
