// src/events/dto/join-anonymous.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Body for `POST /events/:id/join-anonymous` — the one thing an accountless
 * walk-in must provide is a display name; it is all the roster will ever
 * know about them.
 */
export class JoinAnonymousDto {
  @ApiProperty({ example: 'Aung Aung', minLength: 1, maxLength: 50 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string;
}
