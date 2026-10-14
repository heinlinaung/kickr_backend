// src/events/public-events.controller.ts
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EventsService } from './events.service';

/**
 * The PUBLIC event read (2026-10-14): event detail needs no account — a
 * shared link must open for anyone. Auth is OPTIONAL rather than absent so
 * a signed-in caller still gets their flags (`userRole`, `joinedByMe`,
 * `likedByMe`, `isCashier`, and the admin-only proposal fields).
 *
 * Its own controller because EventsController is class-guarded; registered
 * AFTER it in the module so `/events/search`, `/events/joined` and the
 * other static routes keep matching before this `:id`.
 */
@ApiTags('Events')
@Controller('events')
@UseGuards(OptionalJwtAuthGuard)
export class PublicEventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get(':id')
  @ApiOperation({
    summary: 'Event detail, with everything a detail screen needs (public)',
    description:
      'PUBLIC — no token required; private events included. Beyond the ' +
      'event document, this resolves the things a detail screen would ' +
      'otherwise fetch separately: `group` ({ _id, name, logo, wallpaper }, ' +
      'null for a standalone event), `groupRules`, `location` (resolved ' +
      'venue object), `teams` (players populated), `matches`, derived ' +
      "`standings`. With a valid token it also lights up `userRole` (the " +
      "caller's GROUP role), `joinedByMe` (whether the caller is on the " +
      'ROSTER — not the same thing), `likedByMe` and `isCashier`; anonymous ' +
      'callers get null/false for those. An invalid or unknown id is a 404, ' +
      'never a 500.',
  })
  @ApiResponse({ status: 404, description: 'No such event, or a malformed id' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.eventsService.findById(id, user?._id?.toString());
  }
}
