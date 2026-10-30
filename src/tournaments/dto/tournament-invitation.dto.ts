import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { RegisterTeamDto } from './register-team.dto';

/** Groups per `POST /tournaments/:id/invitations`. */
export const MAX_GROUPS_PER_INVITE = 50;

/** Body for `POST /tournaments/:id/invitations`. */
export class CreateTournamentInvitationsDto {
  @ApiProperty({
    type: [String],
    example: ['665f1c2e8b3a4d0012a3b4c5'],
    description: `Groups (clubs) to invite, 1-${MAX_GROUPS_PER_INVITE}. Duplicates are ignored.`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_GROUPS_PER_INVITE)
  @IsMongoId({ each: true })
  groupIds: string[];

  @ApiPropertyOptional({ example: 'Bring your best XI!', maxLength: 280 })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  message?: string;
}

/**
 * Body for `POST /tournament-invitations/:invitationId/accept`: the team the
 * group enters. `clubId` is always the invited group, so it isn't taken.
 */
export class AcceptTournamentInvitationDto extends OmitType(RegisterTeamDto, [
  'clubId',
] as const) {}
