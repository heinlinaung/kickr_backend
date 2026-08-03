import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class SetGroupRulesDto {
  @ApiProperty({
    example: [
      'Be on time — arrive 15-30 minutes before kick-off',
      'No alcohol before the match\n(drink afterwards if you like)',
      'Respect the ref',
    ],
    type: [String],
    description:
      'Replaces the whole rules array. No count limit and no per-rule length limit. ' +
      'Newlines within a rule are preserved verbatim — render with `white-space: pre-line` client-side.',
  })
  @IsArray()
  @IsString({ each: true })
  rules: string[];
}
