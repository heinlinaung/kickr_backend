// src/events/event-templates.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EventsService } from './events.service';
import { CreateEventTemplateDto } from './dto/create-event-template.dto';

/**
 * Reusable event defaults (spec §4.5).
 *
 * Its own controller rather than routes under `/events/:id` because templates
 * are a sibling collection, not a sub-resource of any one event.
 */
@ApiTags('Event templates')
@ApiBearerAuth()
@Controller('event-templates')
@UseGuards(JwtAuthGuard)
export class EventTemplatesController {
  constructor(private eventsService: EventsService) {}

  @Get()
  @ApiOperation({ summary: "The caller's templates, newest first" })
  list(@CurrentUser() user: any) {
    return this.eventsService.listTemplates(user._id.toString());
  }

  @Post()
  @ApiOperation({
    summary: 'Create a template',
    description:
      'Only `name` is required. Whatever else it carries pre-fills the ' +
      'matching field on POST /events when that field is omitted.',
  })
  create(@CurrentUser() user: any, @Body() dto: CreateEventTemplateDto) {
    return this.eventsService.createTemplate(user._id.toString(), dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete one of your own templates' })
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.eventsService.removeTemplate(id, user._id.toString());
  }
}
