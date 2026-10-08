// src/events/dto/create-challenge-event.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { CreateEventDto } from './create-event.dto';

/**
 * Body for `POST /challenges/:id/event` — the proposal event.
 *
 * Everything a normal event takes (date, time, duration, location, …) plus
 * each side's kit color, so the reviewing side can object to a clash before
 * anything is booked. `isPublic` and `groupId` are IGNORED if sent: a
 * challenge event is always private and always belongs to the proposer's
 * side, with the opponent recorded separately.
 */
export class CreateChallengeEventDto extends CreateEventDto {
  @ApiProperty({ example: 'red', description: "The CHALLENGER group's kit color." })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  challengerColor: string;

  @ApiProperty({ example: 'white', description: "The CHALLENGED group's kit color." })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  challengedColor: string;
}
