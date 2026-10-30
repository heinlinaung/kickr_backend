import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional } from 'class-validator';

export class KnockoutBracketDto {
  @ApiPropertyOptional({
    description:
      'Lay out round one by hand: one tournament team id per bracket position, null for a bye. ' +
      'Positions (0,1), (2,3)… are the first-round matches. Required for MANUAL seeding.',
    example: ['t_red', 't_lions', 't_warriors', 't_blue'],
    type: [String],
    nullable: true,
  })
  @IsOptional()
  @IsArray()
  order?: (string | null)[];

  @ApiPropertyOptional({
    description:
      'true confirms the bracket (generating it first if there is none). Omit to (re)generate.',
  })
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}
