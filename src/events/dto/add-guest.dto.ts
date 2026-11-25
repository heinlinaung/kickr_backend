import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Most guests one bulk `POST /events/:id/guests` may create. */
export const MAX_BULK_GUESTS = 20;

/** Body for `POST /events/:id/guests`. */
export class AddGuestDto {
  /**
   * Display name for the guest — all the system knows about them, since a
   * guest has no account and therefore no email, phone or profile.
   *
   * OPTIONAL. Omitted, the server names them
   * `<sponsor name> guest <n>` — "Thant guest 1", "Thant guest 2" — so the
   * client can offer a bare "+ Add Guest" button with nothing to type. Send a
   * value to override it.
   */
  @ApiPropertyOptional({
    example: 'John',
    minLength: 2,
    maxLength: 60,
    description:
      'Display name for the guest. Omit it and the server derives ' +
      '"<sponsor name> guest <n>", e.g. "Thant guest 1".',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  guestName?: string;

  /**
   * How many guests to add in one call — group OWNER/ADMIN only.
   *
   * When sent, every guest gets a sequence number: `guestName: "mg mg"`,
   * `count: 3` creates "mg mg 1", "mg mg 2", "mg mg 3", and a later call
   * continues from the highest number already used ("mg mg 4", ...). Without
   * a `guestName` the default "<sponsor name> guest <n>" sequence is used.
   * Omitted, one guest is added exactly as before.
   */
  @ApiPropertyOptional({
    example: 4,
    minimum: 1,
    maximum: MAX_BULK_GUESTS,
    description:
      'Owner/admin only. Adds this many guests at once, numbered after ' +
      '`guestName` ("mg mg 1", "mg mg 2", ...), continuing from the highest ' +
      'number already on the event. The response is then ' +
      '`{ message, guests: [...] }` instead of a single guest.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_BULK_GUESTS)
  count?: number;
}
