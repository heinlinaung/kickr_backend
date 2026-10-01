// src/events/dto/set-team-formation.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_FORMATION_NAME } from '../events.formation';

/**
 * Where each placed player stands. Ids come from the team's `players`
 * (registered users) or `guests` (roster rows) — the service checks
 * membership; here only the shapes are validated.
 *
 * Which LINES a formation's numbers map to is the client's call: only the
 * sizes of the non-empty groups must match the formation, in
 * defenders -> midfielders -> forwards order. Array order is meaningful and
 * is stored as submitted.
 */
export class FormationPlayersDto {
  @ApiProperty({ example: '665f1a2b3c4d5e6f70819211' })
  @IsMongoId()
  goalkeeper: string;

  @ApiProperty({ type: [String], example: ['665f1a2b3c4d5e6f70819201'] })
  @IsArray()
  @IsMongoId({ each: true })
  defenders: string[];

  @ApiProperty({ type: [String], example: ['665f1a2b3c4d5e6f70819205'] })
  @IsArray()
  @IsMongoId({ each: true })
  midfielders: string[];

  @ApiProperty({ type: [String], example: ['665f1a2b3c4d5e6f70819209'] })
  @IsArray()
  @IsMongoId({ each: true })
  forwards: string[];
}

/**
 * Body for `PUT /events/:id/teams/:teamId/formation` — set or replace.
 *
 * Free-form by design: the formation is NOT checked against the global
 * `/formations` list (that list feeds the client's picker); the server only
 * requires that the arithmetic holds — segments match the group sizes, and
 * segments + goalkeeper = playerCount.
 */
export class SetTeamFormationDto {
  @ApiPropertyOptional({ example: 'My 4-4-2', maxLength: MAX_FORMATION_NAME })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_FORMATION_NAME)
  name?: string;

  @ApiProperty({
    example: 11,
    description: 'Goalkeeper + outfield players; must equal the placed total.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(30)
  playerCount: number;

  @ApiProperty({ example: '4-4-2' })
  @IsString()
  // Shape only — the per-segment and arithmetic rules live in
  // `events.formation.ts` where they are unit-tested.
  @Matches(/^\d+(-\d+)*$/, {
    message: "formation must be numbers joined by dashes, like '4-4-2'",
  })
  formation: string;

  @ApiProperty({ type: FormationPlayersDto })
  @ValidateNested()
  @Type(() => FormationPlayersDto)
  players: FormationPlayersDto;
}
