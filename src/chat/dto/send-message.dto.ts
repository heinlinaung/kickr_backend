// src/chat/dto/send-message.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/** Body for `POST /groups/:id/messages`. */
export class SendMessageDto {
  @ApiProperty({
    example: 'See everyone at 7pm',
    maxLength: 2000,
    description:
      'The message text. Trimmed, and must not be blank once trimmed — a ' +
      'whitespace-only message is not a message. Capped at 2000 characters ' +
      'so one client cannot write an unbounded document.',
  })
  // Trim BEFORE validating, so '   ' fails MinLength rather than being stored
  // as a blank message that renders as an empty bubble.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text: string;
}
