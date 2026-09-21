// src/events/dto/cancel-event.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body for `POST /events/:id/cancel`.
 *
 * `reason` is REQUIRED: the whole point of cancelling over deleting is that
 * players are told why, so a reasonless cancellation is the half-record this
 * endpoint exists to prevent. Length-capped like other free text; trimming is
 * left to the client so multi-line reasons survive verbatim.
 */
export class CancelEventDto {
  @ApiProperty({
    example: 'Pitch flooded — venue closed for the day',
    minLength: 1,
    maxLength: 500,
    description: 'Why the event is cancelled. Shown to every player.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason: string;
}
