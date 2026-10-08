// src/challenges/dto/create-challenge.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

/**
 * Body for `POST /challenges` — group A challenges group B.
 *
 * The caller must be an owner/admin of the CHALLENGER group; the service
 * checks that, that the two groups differ, and that no challenge between
 * the pair is still pending.
 */
export class CreateChallengeDto {
  @ApiProperty({ example: '665f1a2b3c4d5e6f70819200' })
  @IsMongoId()
  challengerGroupId: string;

  @ApiProperty({ example: '665f1a2b3c4d5e6f70819201' })
  @IsMongoId()
  challengedGroupId: string;
}
