import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateMemberRoleDto {
  @ApiProperty({
    example: 'captain',
    required: false,
    enum: ['admin', 'captain', 'member'],
    description: "'owner' is not assignable",
  })
  @IsOptional()
  @IsIn(['admin', 'captain', 'member'])
  role?: string;

  @ApiProperty({ example: 2, required: false, enum: [1, 2, 3] })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2, 3])
  level?: number;
}
