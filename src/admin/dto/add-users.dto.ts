import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsMongoId,
} from 'class-validator';

export class AddUsersDto {
  @ApiProperty({
    type: [String],
    example: ['665f1a2b3c4d5e6f7a8b9c0d', '665f1a2b3c4d5e6f7a8b9c0e'],
    description: 'User ids to add. Deduplicated; max 100 per call.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsMongoId({ each: true })
  userIds: string[];
}
