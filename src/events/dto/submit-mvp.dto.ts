// src/events/dto/submit-mvp.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsMongoId, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Body for `POST /events/:id/mvp` — the MVP's own endpoint, split out of
 * `POST /events/:id/result` (which now records only the overall score).
 *
 * `userId` must be a joined player — checked in the service, which has the
 * roster. Both fields are required: naming an MVP without their goal count is
 * exactly the half-record the split was meant to end.
 */
export class SubmitMvpDto {
  @ApiProperty({
    example: '665f1a2b3c4d5e6f70819200',
    description: 'The MVP player — must have joined this event.',
  })
  @IsMongoId()
  userId: string;

  @ApiProperty({
    example: 12,
    minimum: 0,
    description: 'Goals scored by the MVP.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200)
  goal: number;
}
