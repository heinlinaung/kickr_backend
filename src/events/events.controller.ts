import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';

@ApiTags('Events')
@ApiBearerAuth()
@Controller('events')
@UseGuards(JwtAuthGuard)
export class EventsController {
  constructor(private eventsService: EventsService) {}

  @Get()
  @ApiQuery({
    name: 'region',
    required: false,
    example: 'Myanmar',
    description:
      "Filters by the owning group's country OR city (case-insensitive). " +
      'Events with no group are excluded when set.',
  })
  list(@CurrentUser() user: any, @Query('region') region?: string) {
    return this.eventsService.list(user._id.toString(), region);
  }

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateEventDto) {
    return this.eventsService.create(user._id.toString(), dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.eventsService.findById(id);
  }

  @Post(':id/join')
  join(@Param('id') id: string, @CurrentUser() user: any) {
    return this.eventsService.join(id, user._id.toString());
  }

  @Delete(':id/join')
  leave(@Param('id') id: string, @CurrentUser() user: any) {
    return this.eventsService.leave(id, user._id.toString());
  }

  @Get(':id/players')
  players(@Param('id') id: string) {
    return this.eventsService.listPlayers(id);
  }
}
