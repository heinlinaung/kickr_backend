import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

export class RespondInvitationDto {
  @ApiProperty({ enum: ['approved', 'rejected'], example: 'approved' })
  @IsEnum(['approved', 'rejected'])
  action: 'approved' | 'rejected';
}
