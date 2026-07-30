import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, ArrayMaxSize } from 'class-validator';

export class SetGroupRulesDto {
  @ApiProperty({
    example: ['Be on time', 'No slide tackles', 'Respect the ref'],
    type: [String],
    description: 'max 3 rules',
  })
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  rules: string[];
}
