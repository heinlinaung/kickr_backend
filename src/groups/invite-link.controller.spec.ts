// src/groups/invite-link.controller.spec.ts
import { Test } from '@nestjs/testing';
import { InviteLinkController } from './invite-link.controller';
import { GroupsService } from './groups.service';

const CODE = 'f6f9fe80-b2e0-4505-8645-e22599f43211';

describe('InviteLinkController — GET /g/:code', () => {
  let controller: InviteLinkController;
  const groupsService: any = { resolveInviteCode: jest.fn() };

  /** Express response double capturing what was sent. */
  const resDouble = () => {
    const res: any = {
      statusCode: 200,
      status: jest.fn((c: number) => ((res.statusCode = c), res)),
      type: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    return res;
  };
  /** Request double: what `req.accepts(['html', 'json'])` answers. */
  const reqAccepting = (best: 'html' | 'json') =>
    ({ accepts: jest.fn().mockReturnValue(best) }) as any;

  beforeEach(async () => {
    jest.clearAllMocks();
    groupsService.resolveInviteCode.mockResolvedValue({
      _id: 'g1',
      name: 'Bangkok FC',
      description: 'Sunday football',
      logo: 'https://ik.imagekit.io/kickr/groups/logo.png',
      sportType: 'football',
      isPrivate: false,
    });

    const m = await Test.createTestingModule({
      controllers: [InviteLinkController],
      providers: [{ provide: GroupsService, useValue: groupsService }],
    }).compile();
    controller = m.get(InviteLinkController);
  });

  it('serves an HTML landing page for a valid code — the QR 404 fix', async () => {
    const res = resDouble();

    await controller.open(CODE, reqAccepting('html'), res);

    expect(res.type).toHaveBeenCalledWith('html');
    const html = res.send.mock.calls[0][0] as string;
    expect(html).toContain('Bangkok FC');
    expect(html).toContain(CODE);
    expect(res.statusCode).toBe(200);
  });

  it('escapes user content — a group named <script> must not run', async () => {
    groupsService.resolveInviteCode.mockResolvedValue({
      _id: 'g1',
      name: '<script>alert(1)</script>',
    });
    const res = resDouble();

    await controller.open(CODE, reqAccepting('html'), res);

    const html = res.send.mock.calls[0][0] as string;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('404s an unknown or expired code, still as a human-readable page', async () => {
    groupsService.resolveInviteCode.mockResolvedValue(null);
    const res = resDouble();

    await controller.open(CODE, reqAccepting('html'), res);

    expect(res.statusCode).toBe(404);
    expect(res.type).toHaveBeenCalledWith('html');
    expect(res.send.mock.calls[0][0]).toContain('no longer valid');
  });

  it('returns an enveloped JSON preview when the caller prefers JSON', async () => {
    const res = resDouble();

    await controller.open(CODE, reqAccepting('json'), res);

    const body = res.json.mock.calls[0][0];
    expect(body.data.code).toBe(CODE);
    expect(body.data.group).toMatchObject({
      name: 'Bangkok FC',
      sportType: 'football',
      isPrivate: false,
    });
  });

  it('404s JSON callers with the join-by-code wording', async () => {
    groupsService.resolveInviteCode.mockResolvedValue(null);
    const res = resDouble();

    await controller.open(CODE, reqAccepting('json'), res);

    expect(res.statusCode).toBe(404);
    expect(res.json.mock.calls[0][0].message).toBe(
      'Invalid or expired invite code',
    );
  });
});
