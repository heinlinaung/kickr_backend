import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** Body for `POST /events/:id/guests`. */
export class AddGuestDto {
  @ApiProperty({
    example: 'John',
    minLength: 2,
    maxLength: 60,
    description:
      'Display name for the guest. This is all the system knows about them — ' +
      'a guest has no account, so there is no email, phone or profile.',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  guestName: string;
}
