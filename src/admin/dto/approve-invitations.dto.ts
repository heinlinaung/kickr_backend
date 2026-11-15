import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsMongoId,
  IsOptional,
} from 'class-validator';

/**
 * Body for `POST /admin/events/:eventId/players_approved` — accept pending
 * challenge-event invitations on the invited players' behalf.
 */
export class ApproveInvitationsDto {
  @ApiPropertyOptional({
    example: '665f1a2b3c4d5e6f7a8b9c0a',
    description:
      'Limit to invitations for this side (one of the two challenge groups). ' +
      'Omit to cover both sides.',
  })
  @IsOptional()
  @IsMongoId()
  groupId?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['665f1a2b3c4d5e6f7a8b9c0d', '665f1a2b3c4d5e6f7a8b9c0e'],
    description:
      'Invited user ids to accept. Omit to accept EVERY pending invitation ' +
      '(within groupId, if given). Deduplicated; max 100 per call.',
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsMongoId({ each: true })
  userIds?: string[];
}
