// src/awards/awards.controller.ts
import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
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
import { AWARD_TYPES, AwardType } from './schemas/award.schema';
import { AwardsService } from './awards.service';

const LIMIT_QUERY = {
  name: 'limit',
  required: false,
  example: 20,
  description: 'Page size, 1-50. Defaults to 20.',
} as const;
const CURSOR_QUERY = {
  name: 'cursor',
  required: false,
  description:
    'Opaque pagination cursor. Pass `nextCursor` from the previous ' +
    'response verbatim; omit for the first page. Invalid values give 400.',
} as const;

/**
 * Awards tabs and memories. The MVP write endpoints live on EventsController
 * (`/events/:id/awards/mvp`) because they are gated by event authority.
 * Paths span `/users`, `/groups` and `/me`, so the controller has no prefix.
 */
@ApiTags('Awards')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class AwardsController {
  constructor(private readonly awardsService: AwardsService) {}

  @Get('users/:userId/awards')
  @ApiOperation({
    summary: "A player's Awards tab",
    description:
      'Their own MVP awards (`source: OWN`) plus group awards they added as ' +
      'memories (`source: MEMORY`), newest first. Gated like the profile: ' +
      '404 for a missing, deleted or private account, except your own.',
  })
  @ApiQuery({ name: 'type', required: false, enum: AWARD_TYPES })
  @ApiQuery(LIMIT_QUERY)
  @ApiQuery(CURSOR_QUERY)
  @ApiResponse({ status: 404, description: 'User not found or private' })
  listForUser(
    @Param('userId') userId: string,
    @CurrentUser() user: any,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    if (type !== undefined && !AWARD_TYPES.includes(type as AwardType)) {
      throw new BadRequestException(
        `type must be one of: ${AWARD_TYPES.join(', ')}`,
      );
    }
    return this.awardsService.listForUser(userId, user._id.toString(), {
      type: type as AwardType | undefined,
      limit: limit === undefined ? undefined : Number(limit),
      cursor,
    });
  }

  @Get('groups/:groupId/awards')
  @ApiOperation({
    summary: "A group's Awards tab",
    description:
      "The group's Group Challenge awards, newest first. Each item carries " +
      '`canAddAsMemory` (and `memoryId` once added) for the caller. ' +
      'Approved members only.',
  })
  @ApiQuery(LIMIT_QUERY)
  @ApiQuery(CURSOR_QUERY)
  @ApiResponse({ status: 403, description: 'NOT_GROUP_MEMBER' })
  listForGroup(
    @Param('groupId') groupId: string,
    @CurrentUser() user: any,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.awardsService.listForGroup(groupId, user._id.toString(), {
      limit: limit === undefined ? undefined : Number(limit),
      cursor,
    });
  }

  @Post('groups/:groupId/awards/:awardId/memories')
  @ApiOperation({
    summary: 'Add a group award to my profile',
    description:
      'No body. Eligible = a member of the group when it was awarded AND a ' +
      'player on the winning side of the challenge. Once per award.',
  })
  @ApiResponse({ status: 201, description: '{ memoryId, awardId }' })
  @ApiResponse({ status: 403, description: 'NOT_ELIGIBLE_FOR_MEMORY' })
  @ApiResponse({ status: 404, description: 'AWARD_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'MEMORY_EXISTS' })
  addMemory(
    @Param('groupId') groupId: string,
    @Param('awardId') awardId: string,
    @CurrentUser() user: any,
  ) {
    return this.awardsService.addMemory(groupId, awardId, user._id.toString());
  }

  @Delete('me/memories/:memoryId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Remove a memory from my profile',
    description: "Only the caller's profile changes; the group's award stays.",
  })
  @ApiResponse({ status: 204, description: 'Removed' })
  @ApiResponse({ status: 404, description: 'MEMORY_NOT_FOUND' })
  async removeMemory(
    @Param('memoryId') memoryId: string,
    @CurrentUser() user: any,
  ) {
    await this.awardsService.removeMemory(memoryId, user._id.toString());
  }
}
