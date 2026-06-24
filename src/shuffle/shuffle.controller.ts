import { Controller, Post, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ShuffleService } from './shuffle.service';

@ApiTags('Shuffle')
@ApiBearerAuth()
@Controller('events/:id/shuffle')
@UseGuards(JwtAuthGuard)
export class ShuffleController {
  constructor(private shuffleService: ShuffleService) {}

  @Post()
  shuffle(@Param('id') eventId: string, @CurrentUser() user: any) {
    return this.shuffleService.shuffle(eventId, user._id.toString());
  }
}
