import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateLocationDto } from '../../locations/dto/create-location.dto';

export class AttachLocationDto {
  @ApiProperty({
    required: false,
    description: 'existing location id (must be owned by the caller)',
  })
  @IsOptional()
  @IsMongoId()
  locationId?: string;

  @ApiProperty({
    required: false,
    type: CreateLocationDto,
    description: 'create + attach in one call',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateLocationDto)
  location?: CreateLocationDto;
}
