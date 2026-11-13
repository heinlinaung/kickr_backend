import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsMongoId, IsOptional } from 'class-validator';

/**
 * Body for `POST /events/:id/side/ready` — a challenge side's owner/admin
 * declares their squad final (or takes it back).
 */
export class SideReadyDto {
  @ApiPropertyOptional({
    example: true,
    default: true,
    description:
      'true marks your side ready; false takes it back (only while the event ' +
      'is still in join).',
  })
  @IsOptional()
  @IsBoolean()
  ready?: boolean;

  @ApiPropertyOptional({
    example: '665f1a2b3c4d5e6f70819200',
    description:
      'Which side you are acting for. Only needed when you are owner/admin ' +
      'of BOTH groups; otherwise your side is worked out for you.',
  })
  @IsOptional()
  @IsMongoId()
  groupId?: string;
}
