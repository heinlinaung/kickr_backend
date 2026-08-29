import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { TEAM_MEMBER_ROLES } from '../schemas/team.schema';
import type { TeamMemberRole } from '../schemas/team.schema';

/** Body for `PATCH /events/:id/teams/:teamId/members/:userId/role`. */
export class SetTeamMemberRoleDto {
  @ApiProperty({
    enum: TEAM_MEMBER_ROLES,
    example: 'captain',
    description:
      'The role this player holds in this team. Setting `player` clears an ' +
      'existing captaincy — it is the default, so it is stored as absence.',
  })
  @IsEnum(TEAM_MEMBER_ROLES)
  role: TeamMemberRole;
}
