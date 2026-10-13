// src/events/dto/respond-invitation.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const INVITATION_RESPONSES = ['accept', 'reject'] as const;

/**
 * Body for `POST /events/:id/invitation/respond` — the invited player's
 * answer to a challenge-event assignment. The reason is OPTIONAL on reject
 * and is shown to the side's admins so they can refill the slot.
 */
export class RespondInvitationDto {
  @ApiProperty({ enum: INVITATION_RESPONSES, example: 'accept' })
  @IsIn(INVITATION_RESPONSES as unknown as string[])
  action: string;

  @ApiPropertyOptional({ example: 'Injured this week' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
