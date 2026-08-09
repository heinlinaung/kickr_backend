import { Injectable } from '@nestjs/common';
import { EventsService } from '../events/events.service';

/**
 * Server-side team shuffle — the optional fallback of spec §4.3.3.
 *
 * This used to own the whole shuffle: Fisher-Yates into buckets of 6 with
 * numeric team names, its own copy of the organizer check, and no fixtures.
 * All of that moved to `EventsService.shuffleTeams`, which deals colour teams
 * and routes through the same persistence path as a client submission — so
 * fixtures, chats and notifications behave identically whichever entry point
 * ran (§4.3.2).
 *
 * Keeping the module means `POST /events/:id/shuffle` stays a stable URL for
 * clients; it is now a thin delegate rather than a second implementation.
 * Consolidating here also removed the duplicated organizer check that made a
 * group event's creator able to edit but not shuffle their own event.
 */
@Injectable()
export class ShuffleService {
  constructor(private readonly eventsService: EventsService) {}

  async shuffle(eventId: string, requesterId: string) {
    return this.eventsService.shuffleTeams(eventId, requesterId);
  }
}
