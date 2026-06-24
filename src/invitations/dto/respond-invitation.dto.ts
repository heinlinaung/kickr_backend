import { IsEnum } from 'class-validator';

export class RespondInvitationDto {
  @IsEnum(['approved', 'rejected'])
  action: 'approved' | 'rejected';
}
