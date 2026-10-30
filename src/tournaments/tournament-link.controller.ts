// src/tournaments/tournament-link.controller.ts
import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { TournamentsService } from './tournaments.service';
import { tournamentDeepLink } from '../common/deep-links';
import { esc, page } from '../common/landing-page';

/**
 * Serves the tournament share LINK — the URL inside its QR code
 * (`{APP_BASE_URL}/t/{code}`, from `GET /tournaments/:id/qr`).
 *
 * Same shape as the group invite page (`GET /g/:code`): opened by a phone
 * camera with no session, so there is no JwtAuthGuard, and browsers get HTML
 * while a client asking for `application/json` gets an enveloped preview.
 * It only PRESENTS the tournament; joining happens in the app through
 * `POST /tournaments/join-by-code`.
 */
@ApiTags('Tournaments')
@Controller('t')
export class TournamentLinkController {
  constructor(private readonly tournamentsService: TournamentsService) {}

  @Get(':code')
  @ApiOperation({
    summary: 'Open a tournament QR / share link (public)',
    description:
      'The landing page behind a tournament QR code. No auth — it is opened from a camera scan. ' +
      'Returns HTML for browsers, or a JSON preview (`code`, `deepLink`, `tournament` with ' +
      '`registrationOpen` and `hostGroup`) when the request prefers `application/json`. An unknown ' +
      'code is a 404 either way. Joining happens in the app via POST /tournaments/join-by-code.',
  })
  @ApiParam({ name: 'code', description: 'The code from the QR link' })
  @ApiResponse({ status: 200, description: 'Landing page / preview' })
  @ApiResponse({ status: 404, description: 'Unknown code' })
  async open(
    @Param('code') code: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const tournament = await this.tournamentsService.resolveInviteCode(code);
    const wantsJson = req.accepts(['html', 'json']) === 'json';

    if (!tournament) {
      if (wantsJson) {
        return res.status(404).json({
          statusCode: 404,
          code: 'INVALID_INVITE_CODE',
          message: 'This tournament link is not valid',
        });
      }
      return res
        .status(404)
        .type('html')
        .send(
          page(
            'Tournament link not found',
            `<h1>This tournament link is not valid</h1>
             <p>Check the link, or ask the organizer to share the QR code again.</p>`,
          ),
        );
    }

    const deepLink = tournamentDeepLink(String(tournament._id));

    if (wantsJson) {
      // Hand-wrapped in { data }: @Res() bypasses the global envelope.
      return res.json({ data: { code, deepLink, tournament } });
    }

    const title = esc(tournament.title);
    const host = tournament.hostGroup;
    const logo = host?.logo
      ? `<img class="logo" src="${esc(host.logo)}" alt="" />`
      : '';
    const spots = `${tournament.currentTeams} / ${tournament.maxTeams} teams`;
    const status = tournament.registrationOpen
      ? `<p>Registration is open — ${esc(spots)}.</p>`
      : `<p><strong>Registration is closed</strong> (${esc(spots)}).</p>`;
    // Auto-jump into the app when it is installed; otherwise this page with
    // the button and the code stays as the fallback (see InviteLinkController).
    return res.type('html').send(
      page(
        `${tournament.title} on KickR`,
        `${logo}
         <h1>${title}</h1>
         ${host ? `<p class="desc">Hosted by ${esc(host.name)}</p>` : ''}
         ${status}
         <a class="open" href="${esc(deepLink)}">Open in KickR</a>
         <p class="fine">Don’t have the app, or nothing happened?</p>
         <ol>
           <li>Open the KickR app</li>
           <li>Go to <strong>Tournaments → Join with code</strong></li>
           <li>Enter the code below (or scan the QR again inside the app)</li>
         </ol>
         <p class="code">${esc(code.toUpperCase())}</p>
         <script>setTimeout(function () { window.location.href = ${JSON.stringify(deepLink)}; }, 30);</script>`,
      ),
    );
  }
}
