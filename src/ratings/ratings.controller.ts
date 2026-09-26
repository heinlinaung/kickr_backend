// src/ratings/ratings.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
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
import { CreateRatingDto } from './dto/create-rating.dto';
import { RatingsService } from './ratings.service';

@ApiTags('Ratings')
@ApiBearerAuth()
@Controller('ratings')
@UseGuards(JwtAuthGuard)
export class RatingsController {
  constructor(private readonly ratings: RatingsService) {}

  @Post()
  @ApiOperation({
    summary: 'Rate a player, event, or group — or replace your rating',
    description:
      '1-5 stars with an optional written review, optionally anonymous. ' +
      'One rating per user per target: submitting again REPLACES your ' +
      'previous rating (stars, text and anonymity together). ' +
      'Eligibility — group: approved members (not the owner); event: joined ' +
      "players once the event is 'after_match' or 'done' (not the " +
      'organizer, never a cancelled event); player: someone you finished an ' +
      'event with (never yourself).',
  })
  @ApiResponse({ status: 400, description: 'Bad target, own target, or unfinished event' })
  @ApiResponse({ status: 403, description: 'Caller is not eligible to rate this target' })
  @ApiResponse({ status: 404, description: 'Target not found' })
  submit(@CurrentUser() user: any, @Body() dto: CreateRatingDto) {
    return this.ratings.submit(user._id.toString(), dto);
  }

  @Get('summary')
  @ApiOperation({
    summary: "One target's rating aggregate",
    description:
      'Average (1 decimal), total count, per-star breakdown, and the ' +
      "caller's own rating (`myRating`, null if they have not rated it) so " +
      'the client can pre-fill the edit form. Computed on read, never stored.',
  })
  @ApiQuery({ name: 'targetType', enum: ['player', 'event', 'group'] })
  @ApiQuery({ name: 'targetId', type: String })
  summary(
    @CurrentUser() user: any,
    @Query('targetType') targetType: string,
    @Query('targetId') targetId: string,
  ) {
    return this.ratings.summary(targetType, targetId, user._id.toString());
  }

  @Get()
  @ApiOperation({
    summary: "One target's ratings, newest first",
    description:
      'Keyset-paginated (`items`, `nextCursor`, `hasMore`). An anonymous ' +
      'rating shows `rater: null` to everyone but its author, who sees ' +
      'their own row unmasked with `mine: true`.',
  })
  @ApiQuery({ name: 'targetType', enum: ['player', 'event', 'group'] })
  @ApiQuery({ name: 'targetId', type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  list(
    @CurrentUser() user: any,
    @Query('targetType') targetType: string,
    @Query('targetId') targetId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.ratings.list(
      targetType,
      targetId,
      limit === undefined ? undefined : Number(limit),
      cursor,
      user._id.toString(),
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete your own rating' })
  @ApiResponse({ status: 403, description: 'Not the author of this rating' })
  @ApiResponse({ status: 404, description: 'Rating not found' })
  remove(@CurrentUser() user: any, @Param('id') ratingId: string) {
    return this.ratings.remove(ratingId, user._id.toString());
  }
}
