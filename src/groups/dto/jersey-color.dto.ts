import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * One team kit: shirt colour + shorts colour. A group carries a list of these
 * because teams usually own more than one kit (home / away / third).
 *
 * Colours are free text — a name ("white") or a hex code ("#FFFFFF") — so the
 * client decides how to render them. Either colour may be omitted.
 */
export class JerseyColorDto {
  @ApiProperty({
    example: 'white',
    required: false,
    description: 'shirt (top) colour',
  })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  top?: string;

  @ApiProperty({
    example: 'white',
    required: false,
    description: 'shorts (pant) colour',
  })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  pant?: string;
}
