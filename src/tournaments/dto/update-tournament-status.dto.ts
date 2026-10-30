import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export const SETTABLE_STATUSES = [
  'DRAFT',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'CANCELLED',
] as const;

export class UpdateTournamentStatusDto {
  @ApiProperty({
    enum: SETTABLE_STATUSES,
    description:
      'Phase statuses are reached through the phase endpoints, not set directly',
  })
  @IsIn(SETTABLE_STATUSES)
  status: (typeof SETTABLE_STATUSES)[number];
}
