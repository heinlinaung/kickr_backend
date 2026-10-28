import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

/** Body for `POST /friend-requests`. */
export class SendFriendRequestDto {
  @ApiProperty({ example: '665f1c2e8b3a4d0012a3b4c5' })
  @IsMongoId()
  toUserId: string;
}
