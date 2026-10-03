// src/groups/dto/set-cashier.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, ValidateIf } from 'class-validator';

/**
 * Body for `PATCH /groups/:id/cashier` — owner only.
 *
 * One cashier per group. `userId` must be an approved member or the owner
 * themself (the owner is not automatically cashier — they "grant themself").
 * Explicit null removes the cashier, which BLOCKS payment reviews until a
 * new one is appointed.
 */
export class SetCashierDto {
  @ApiProperty({
    example: '665f1a2b3c4d5e6f70819200',
    nullable: true,
    description: 'The new cashier, or null to remove the current one.',
  })
  @ValidateIf((dto: SetCashierDto) => dto.userId !== null)
  @IsMongoId()
  userId: string | null;
}
