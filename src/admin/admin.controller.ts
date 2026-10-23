import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AdminKeyGuard,
  ADMIN_KEY_HEADER,
} from '../common/guards/admin-key.guard';
import { AdminService } from './admin.service';
import { TestDataService } from './test-data.service';
import { AddUsersDto } from './dto/add-users.dto';
import { SeedTestDataDto } from './dto/seed-test-data.dto';
import { MarkPaymentsPaidDto } from './dto/mark-payments-paid.dto';

/**
 * Server-to-server support endpoints. Authenticated by the ADMIN_KEY shared
 * secret, NOT by a user JWT — there is no acting user here.
 */
@ApiTags('Admin')
@ApiHeader({
  name: ADMIN_KEY_HEADER,
  description: 'Shared admin secret (ADMIN_KEY)',
  required: true,
})
@Controller('admin')
@UseGuards(AdminKeyGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly testDataService: TestDataService,
  ) {}

  /** Force-add users to a group as approved members, skipping owner approval. */
  @Post('groups/:groupId/members')
  addGroupMembers(@Param('groupId') groupId: string, @Body() dto: AddUsersDto) {
    return this.adminService.addGroupMembers(groupId, dto.userIds);
  }

  /** Force-add users to an event, ignoring its lifecycle state. */
  @Post('events/:eventId/players')
  addEventPlayers(@Param('eventId') eventId: string, @Body() dto: AddUsersDto) {
    return this.adminService.addEventPlayers(eventId, dto.userIds);
  }

  @Post('events/:eventId/payment')
  @ApiOperation({
    summary: 'Test data: mark joined players as paid',
    description:
      'Writes an APPROVED payment row covering the current price for each ' +
      'user id, bypassing submit and cashier review. Users not joined to the ' +
      'event, or already fully paid, are skipped with a reason. On a settled ' +
      'group event the payment also posts to the group fund (LATE_PAYMENT).',
  })
  markEventPaymentsPaid(
    @Param('eventId') eventId: string,
    @Body() dto: MarkPaymentsPaidDto,
  ) {
    return this.adminService.markEventPaymentsPaid(
      eventId,
      dto.userIds,
      dto.method,
    );
  }

  // --- Test-data seeding -------------------------------------------------

  @Post('test-data')
  @ApiOperation({
    summary: 'Seed a test fixture and assert group/event behaviour',
    description:
      'Creates 22 role-tagged users (1 owner, 2 captains, 3 admins, 16 ' +
      'members) via real Cognito signup, a group, 3 locations and — in full ' +
      'mode — an event with 2 teams driven through the whole lifecycle. ' +
      'Existing email addresses are refused and logged rather than reused. ' +
      'Returns a per-assertion pass/fail report plus the testId. Nothing is ' +
      'cleaned up: call DELETE /admin/test-data/:testId when finished.',
  })
  seedTestData(@Body() dto: SeedTestDataDto) {
    return this.testDataService.seed(dto);
  }

  @Get('test-data')
  @ApiOperation({ summary: 'List recent test runs (newest first, max 50)' })
  listTestRuns() {
    return this.testDataService.listRuns();
  }

  @Get('test-data/:testId')
  @ApiOperation({ summary: 'Everything one run created, for verification' })
  getTestRun(@Param('testId') testId: string) {
    return this.testDataService.findRun(testId);
  }

  @Delete('test-data/:testId')
  @ApiOperation({
    summary: 'Delete everything a run created, Cognito identities included',
  })
  cleanupTestData(@Param('testId') testId: string) {
    return this.testDataService.cleanup(testId);
  }
}
