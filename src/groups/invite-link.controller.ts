// src/groups/invite-link.controller.ts
import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { GroupsService } from './groups.service';
import { groupDeepLink } from '../common/deep-links';

/**
 * Serves the invite LINK — the URL inside a group's QR code
 * (`{APP_BASE_URL}/g/{code}`, minted by `GroupsService.getQr`).
 *
 * This route existed only as a string until now: the QR pointed browsers at
 * `/g/:code` and the API answered 404. It is opened by a phone camera or a
 * desktop browser, i.e. by someone with NO session — so, uniquely for this
 * API, there is no JwtAuthGuard, and the response is a human-readable HTML
 * page rather than enveloped JSON (a client sending `Accept:
 * application/json` gets JSON instead).
 *
 * It only PRESENTS the invite; joining still happens in the app through
 * `POST /invitations/groups/join-by-code`, which creates a pending request an
 * owner/admin must approve. Exposing the page to strangers therefore leaks no
 * entry — the same reasoning that lets any authenticated user fetch the QR.
 */
@ApiTags('Groups')
@Controller('g')
export class InviteLinkController {
  constructor(private readonly groupsService: GroupsService) {}

  @Get(':code')
  @ApiOperation({
    summary: 'Open a group invite link (public)',
    description:
      'The landing page behind a group QR code. No auth — it is opened from ' +
      'a camera scan. Returns HTML for browsers, or a JSON group preview ' +
      'when the request prefers `application/json`. Valid means what ' +
      'join-by-code will accept: an unknown or expired code is a 404 either ' +
      'way. Joining itself still happens in the app via ' +
      'POST /invitations/groups/join-by-code.',
  })
  @ApiParam({ name: 'code', description: 'The invite code from the QR link' })
  @ApiResponse({ status: 200, description: 'Invite landing page / preview' })
  @ApiResponse({ status: 404, description: 'Unknown or expired invite code' })
  async open(
    @Param('code') code: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const group = await this.groupsService.resolveInviteCode(code);
    // Browsers ask for text/html; the mobile app asks for application/json.
    const wantsJson = req.accepts(['html', 'json']) === 'json';

    if (!group) {
      if (wantsJson) {
        return res
          .status(404)
          .json({ statusCode: 404, message: 'Invalid or expired invite code' });
      }
      return res
        .status(404)
        .type('html')
        .send(
          page(
            'Invite link expired',
            `<h1>This invite link is no longer valid</h1>
             <p>It may have expired — invite codes last 24 hours — or been
             replaced. Ask a group admin to share a fresh QR code.</p>`,
          ),
        );
    }

    const deepLink = groupDeepLink(String(group._id));

    if (wantsJson) {
      // Hand-wrapped in { data } to match the API's global envelope, which
      // @Res() bypasses.
      return res.json({
        data: {
          code,
          deepLink,
          group: {
            _id: group._id,
            name: group.name,
            description: group.description ?? '',
            logo: group.logo ?? null,
            sportType: group.sportType ?? null,
            isPrivate: group.isPrivate ?? false,
          },
        },
      });
    }

    // Group names/descriptions are user content — escaped, or a group named
    // `<script>…` would run in every scanner's browser.
    const name = esc(group.name);
    const logo = group.logo
      ? `<img class="logo" src="${esc(group.logo)}" alt="" />`
      : '';
    // The auto-attempt below jumps a phone WITH the app straight to the group
    // details screen, which is the whole point of scanning; without the app
    // the scheme is unregistered, nothing navigates (at worst iOS shows one
    // alert), and this page with the button and the code remains the
    // fallback. JSON.stringify — not esc() — for the script value: it needs a
    // JS string literal, and the id is server-made anyway.
    return res.type('html').send(
      page(
        `Join ${name} on KickR`,
        `${logo}
         <h1>${name}</h1>
         ${group.description ? `<p class="desc">${esc(group.description)}</p>` : ''}
         <p>You’ve been invited to join this group on <strong>KickR</strong>.</p>
         <a class="open" href="${esc(deepLink)}">Open in KickR</a>
         <p class="fine">Don’t have the app, or nothing happened?</p>
         <ol>
           <li>Open the KickR app</li>
           <li>Go to <strong>Groups → Join with code</strong></li>
           <li>Enter the code below (or scan the QR again inside the app)</li>
         </ol>
         <p class="code">${esc(code)}</p>
         <p class="fine">Joining sends a request that a group admin approves.</p>
         <script>setTimeout(function () { window.location.href = ${JSON.stringify(deepLink)}; }, 30);</script>`,
      ),
    );
  }
}

/** Minimal HTML escape for user content interpolated into the page. */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The page shell. Self-contained inline CSS — this is served by the API with
 * no static assets, and it must render fine in the throwaway browser tab a
 * camera scan opens.
 */
function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
         sans-serif; margin: 0; padding: 24px; display: flex;
         justify-content: center; background: #f4f5f7; color: #1a1c1f; }
  main { max-width: 420px; width: 100%; background: #fff; border-radius: 16px;
         padding: 32px 28px; box-shadow: 0 2px 12px rgba(0,0,0,.08);
         text-align: center; }
  .logo { width: 96px; height: 96px; border-radius: 50%; object-fit: cover; }
  h1 { font-size: 1.4rem; margin: 12px 0 4px; }
  .desc { color: #5c6470; margin-top: 0; }
  ol { text-align: left; margin: 16px auto; padding-left: 24px; }
  .code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 1.05rem; background: #f0f2f5; border-radius: 8px;
          padding: 12px; word-break: break-all; user-select: all; }
  .open { display: block; margin: 20px auto 4px; padding: 14px 20px;
          background: #16a34a; color: #fff; border-radius: 10px;
          font-weight: 600; text-decoration: none; }
  .fine { color: #8a919c; font-size: .85rem; }
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}
