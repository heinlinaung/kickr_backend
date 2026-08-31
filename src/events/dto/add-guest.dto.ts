import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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
}
