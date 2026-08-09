import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { EVENT_STATUSES } from '../events.lifecycle';
import type { EventStatus } from '../events.lifecycle';

/**
 * Target state for PATCH /events/:id/status.
 *
 * `@IsEnum` rejects values outside the six states with a 400 before the
 * service runs; whether the move is *legal from the current state* is the
 * transition table's job and answers 409.
 */
export class UpdateEventStatusDto {
  @ApiProperty({
    enum: EVENT_STATUSES,
    example: 'before_match',
    description:
      'Target lifecycle state. Must be reachable from the current one.',
  })
  @IsEnum(EVENT_STATUSES)
  status: EventStatus;
}
