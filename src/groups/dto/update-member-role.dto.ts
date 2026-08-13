import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateMemberRoleDto {
  @ApiProperty({
    example: 'captain',
    required: false,
    enum: ['admin', 'captain', 'vice-captain', 'referee', 'member'],
    description:
      "'owner' is not assignable — a group has exactly one, and changing it " +
      'needs an ownership-transfer flow that does not exist yet. ' +
      "'referee' is a label only: it grants exactly what 'member' does.",
  })
  @IsOptional()
  @IsIn(['admin', 'captain', 'vice-captain', 'referee', 'member'])
  role?: string;

  @ApiProperty({ example: 2, required: false, enum: [1, 2, 3] })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2, 3])
  level?: number;
}
