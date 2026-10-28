import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { LocationsService } from './locations.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

// Lives in LocationsModule rather than GroupsModule: GroupsModule already
// imports LocationsModule, so the service dependency only points one way.
@ApiTags('Groups')
@ApiBearerAuth()
@Controller('groups/:groupId/locations')
@UseGuards(JwtAuthGuard)
export class GroupLocationsController {
  constructor(private locationsService: LocationsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a group location (owner/admin, max 5 per group)',
  })
  create(
    @Param('groupId') groupId: string,
    @CurrentUser() user: any,
    @Body() dto: CreateLocationDto,
  ) {
    return this.locationsService.createForGroup(
      groupId,
      user._id.toString(),
      dto,
    );
  }

  @Get()
  @ApiOperation({ summary: "List the group's locations (populated)" })
  list(@Param('groupId') groupId: string) {
    return this.locationsService.listForGroup(groupId);
  }

  @Get(':locationId')
  findOne(
    @Param('groupId') groupId: string,
    @Param('locationId') locationId: string,
  ) {
    return this.locationsService.findForGroup(groupId, locationId);
  }

  @Patch(':locationId')
  @ApiOperation({
    summary: 'Update a group-owned location (owner/admin/captain/vice-captain)',
  })
  update(
    @Param('groupId') groupId: string,
    @Param('locationId') locationId: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.locationsService.updateForGroup(
      groupId,
      locationId,
      user._id.toString(),
      dto,
    );
  }

  @Delete(':locationId')
  @ApiOperation({
    summary:
      'Delete a group-owned location, or detach one owned elsewhere (owner/admin)',
  })
  remove(
    @Param('groupId') groupId: string,
    @Param('locationId') locationId: string,
    @CurrentUser() user: any,
  ) {
    return this.locationsService.removeForGroup(
      groupId,
      locationId,
      user._id.toString(),
    );
  }
}
