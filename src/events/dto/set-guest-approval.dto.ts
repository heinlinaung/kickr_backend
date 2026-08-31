import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

/**
 * Body for `PATCH /events/:id/guests/:guestId/approval`.
 *
 * `pending` is deliberately not accepted: it is the state a guest is created
 * in, and moving one back to it after a decision would leave the organizer's
 * own approval silently undone.
 */
export class SetGuestApprovalDto {
  @ApiProperty({
    enum: ['approved', 'rejected'],
    example: 'approved',
    description:
      'Approving puts the guest on the roster and counts them toward ' +
      'joinedCount. Rejecting leaves them off it. `pending` is not accepted.',
  })
  @IsIn(['approved', 'rejected'])
  approval: 'approved' | 'rejected';
}
