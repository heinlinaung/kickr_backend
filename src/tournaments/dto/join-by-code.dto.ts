import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { RegisterTeamDto } from './register-team.dto';

/**
 * Body for `POST /tournaments/join-by-code`: the code from the tournament's
 * QR / share link, plus the team to register.
 */
export class JoinTournamentByCodeDto extends RegisterTeamDto {
  @ApiProperty({
    example: 'K7QM4XPA',
    description:
      'The code from the QR / share link (`…/t/{code}`). Case-insensitive.',
  })
  @IsString()
  @Length(4, 32)
  code: string;
}
