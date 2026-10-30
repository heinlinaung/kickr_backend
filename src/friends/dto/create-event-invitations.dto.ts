import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { MAX_INVITEES_PER_REQUEST } from '../friends.helpers';

/** Body for `POST /events/:eventId/invitations`. */
export class CreateEventInvitationsDto {
  @ApiProperty({
    type: [String],
    example: ['665f1c2e8b3a4d0012a3b4c5'],
    description: `Friends to invite, 1-${MAX_INVITEES_PER_REQUEST}. Duplicates are ignored.`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_INVITEES_PER_REQUEST)
  @IsMongoId({ each: true })
  userIds: string[];

  @ApiPropertyOptional({ example: 'Join us on Sunday!', maxLength: 280 })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  message?: string;
}
