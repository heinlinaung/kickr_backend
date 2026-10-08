// src/events/dto/assign-players.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsMongoId } from 'class-validator';

/**
 * Body for `POST /events/:id/players/assign` — a challenge event's roster is
 * ASSIGNED, not joined. The caller's side is inferred from which of the two
 * groups they are owner/admin of; every assignee must be an approved member
 * of that side.
 */
export class AssignPlayersDto {
  @ApiProperty({ type: [String], example: ['665f1a2b3c4d5e6f70819200'] })
  @IsArray()
  @ArrayNotEmpty()
  @IsMongoId({ each: true })
  userIds: string[];
}
