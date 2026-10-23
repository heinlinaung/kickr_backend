// src/finance/dto/reopen-event.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** Body for `POST /events/:eventId/reopen` — owner only, reason required. */
export class ReopenEventDto {
  @ApiProperty({ example: 'Drinks receipt was 250, not 200' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason: string;
}
