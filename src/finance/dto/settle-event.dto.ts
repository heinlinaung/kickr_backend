// src/finance/dto/settle-event.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** Body for `POST /events/:eventId/settle`. */
export class SettleEventDto {
  @ApiPropertyOptional({ example: 'Player C will pay next week' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    example: true,
    description:
      'Must be true to settle while players still owe; otherwise 409 ' +
      'OUTSTANDING_PAYMENTS lists who owes.',
  })
  @IsOptional()
  @IsBoolean()
  allowOutstanding?: boolean;
}
