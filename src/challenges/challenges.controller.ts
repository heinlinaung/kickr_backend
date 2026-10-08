// src/challenges/challenges.controller.ts
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EventsService } from '../events/events.service';
import { CreateChallengeEventDto } from '../events/dto/create-challenge-event.dto';
import { ChallengesService } from './challenges.service';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { RespondChallengeDto } from './dto/respond-challenge.dto';

@ApiTags('Challenges')
@ApiBearerAuth()
@Controller('challenges')
@UseGuards(JwtAuthGuard)
export class ChallengesController {
  constructor(
    private readonly challenges: ChallengesService,
    private readonly events: EventsService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Challenge another group (owner/admin of the challenger group)',
    description:
      'Creates a group-vs-group challenge in status `proposed` and notifies ' +
      'the challenged group\'s owner/admins. One PENDING challenge per group ' +
      'pair at a time; a rematch after a verdict is a new challenge.',
  })
  @ApiResponse({ status: 400, description: 'Self-challenge or one already pending' })
  @ApiResponse({ status: 403, description: 'Caller is not a challenger-group admin' })
  create(@CurrentUser() user: any, @Body() dto: CreateChallengeDto) {
    return this.challenges.create(user._id.toString(), dto);
  }

  @Get()
  @ApiOperation({
    summary: "A group's challenges, both directions (members)",
  })
  @ApiQuery({ name: 'groupId', type: String })
  list(@CurrentUser() user: any, @Query('groupId') groupId: string) {
    return this.challenges.listForGroup(groupId, user._id.toString());
  }

  @Patch(':id/respond')
  @ApiOperation({
    summary: 'Accept or reject a challenge (challenged group owner/admin)',
    description:
      '`action` accept|reject with an OPTIONAL reason. Only a `proposed` ' +
      'challenge can be answered; the verdict is final for that challenge.',
  })
  @ApiResponse({ status: 400, description: 'Already answered' })
  @ApiResponse({ status: 403, description: 'Caller is not a challenged-group admin' })
  respond(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: RespondChallengeDto,
  ) {
    return this.challenges.respond(id, user._id.toString(), dto);
  }

  @Post(':id/event')
  @ApiOperation({
    summary: 'Propose the match event for an ACCEPTED challenge',
    description:
      'Either side\'s owner/admin. Normal event body plus both kit colors ' +
      '(`challengerColor`, `challengedColor`). The event is forced private, ' +
      "typed 'challenge', and starts at proposedStatus 'proposed' — inert " +
      'until the other side accepts via PATCH /events/:id/proposal/review. ' +
      'One challenge, one event; it counts toward your weekly plan limit.',
  })
  @ApiResponse({
    status: 400,
    description: 'Challenge not accepted, or it already has its event',
  })
  @ApiResponse({ status: 403, description: 'Caller is not an admin of either group' })
  createEvent(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: CreateChallengeEventDto,
  ) {
    return this.events.createChallengeEvent(id, user._id.toString(), dto);
  }
}
