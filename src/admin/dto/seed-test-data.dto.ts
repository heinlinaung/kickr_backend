// src/admin/dto/seed-test-data.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Body for `POST /admin/test-data`.
 *
 * The email prefix/postfix pair builds every seeded address, e.g.
 * `test` + `@example.com` -> `test-owner-01@example.com`.
 */
export class SeedTestDataDto {
  @ApiProperty({ example: 'test', description: 'Local-part prefix for seeded emails' })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  // Restricted to what is safe in an email local part — the value is
  // concatenated into an address that Cognito will validate anyway, but
  // rejecting early gives a far clearer error than a Cognito rejection.
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'emailPrefix may contain only letters, digits, dot, underscore, hyphen',
  })
  emailPrefix: string;

  @ApiProperty({ example: '@example.com', description: 'Domain part, including @' })
  @IsString()
  @MinLength(3)
  @MaxLength(60)
  @Matches(/^@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, {
    message: 'emailPostfix must look like @example.com',
  })
  emailPostfix: string;

  @ApiProperty({
    enum: ['full', 'partial'],
    default: 'full',
    required: false,
    description:
      'full: users, group, locations, event and teams, with every check. ' +
      'partial: users and group only, group checks only.',
  })
  @IsOptional()
  @IsIn(['full', 'partial'])
  mode?: 'full' | 'partial';

  @ApiProperty({
    required: false,
    description:
      'Password for the seeded Cognito users. Must satisfy the pool policy. ' +
      'Defaults to a generated value that meets the usual complexity rules.',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  password?: string;
}
