// src/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

/**
 * Liveness probe for the deploy workflow and the image's HEALTHCHECK.
 *
 * Deliberately public and dependency-free. It used to be `/api-docs-json` that
 * played this role, which broke the moment basic auth went in front of the
 * docs — a probe should never be coupled to something that can be gated for
 * unrelated reasons.
 *
 * This still proves what the old probe proved. Nest binds no port until the
 * whole module graph resolves, and Mongoose blocks that until it has connected
 * to Mongo — so a 200 here means the app is genuinely serving, not merely
 * started. Keep it free of injected dependencies so it cannot fail for any
 * reason other than "the process is not up".
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiResponse({ status: 200, description: '`{ status: "ok" }`' })
  @ApiOperation({
    summary: 'Liveness probe (public)',
    description:
      'Returns 200 once the app is serving. Used by the deploy workflow ' +
      'and the container HEALTHCHECK; not intended for app clients.',
  })
  check() {
    return { status: 'ok' };
  }
}
