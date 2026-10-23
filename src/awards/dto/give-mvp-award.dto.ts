// src/awards/dto/give-mvp-award.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for `POST|PATCH /events/:id/awards/mvp`.
 *
 * `userId` must be a joined player — checked in the service, which has the
 * roster. Goal/assist counts stay on the legacy `POST /events/:id/mvp`; this
 * body carries the award's free-text note instead.
 */
export class GiveMvpAwardDto {
  @ApiProperty({
    example: '665f1a2b3c4d5e6f70819200',
    description: 'The MVP player — must have joined this event.',
  })
  @IsMongoId()
  userId: string;

  @ApiProperty({
    example: '2 goals, 1 assist',
    required: false,
    maxLength: 300,
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
