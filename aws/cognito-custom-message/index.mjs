/**
 * Cognito "Custom message" Lambda trigger.
 *
 * Replaces Cognito's plain-text forgot-password email with the branded KickR
 * template. Every other trigger source is returned untouched, so sign-up
 * verification etc. keep using the pool's default message.
 *
 * Deploy: Node.js 20.x runtime, handler `index.handler`.
 * Env:    LOGO_URL – public HTTPS URL of the KickR logo as PNG (~240px wide).
 *                   Email clients block SVG and data: URIs, so it must be hosted.
 * Attach: Cognito → User pool → User pool properties → Lambda triggers →
 *         Messaging → Custom message.
 *
 * Note: Cognito forgot-password codes are valid for 1 hour (not configurable),
 * so the template states 1 hour.
 */

const LOGO_URL =
  process.env.LOGO_URL || 'https://kickrsport.com/email/kickr-logo.png';
const SITE_URL = 'https://kickrsport.com';
const SITE_LABEL = 'kickrsport.com';

const forgotPasswordEmail = (code) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>Reset your password</title>
</head>
<body style="margin:0;padding:0;background:#f1f3f0;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your KickR password reset code is ${code}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f3f0;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

<tr><td align="center" style="padding:40px 48px 32px;">
<img src="${LOGO_URL}" width="150" alt="KickR" style="display:block;width:150px;max-width:100%;height:auto;border:0;">
</td></tr>
<tr><td style="padding:0 48px;"><div style="border-top:1px solid #e6e8e4;font-size:0;line-height:0;">&nbsp;</div></td></tr>

<tr><td style="padding:36px 48px 0;">
<h1 style="margin:0 0 14px;font-size:28px;line-height:1.25;font-weight:700;color:#141414;">Reset your password</h1>
<p style="margin:0;font-size:17px;line-height:1.6;color:#4a4a4a;">We got a request to reset the password for your KickR account. Enter this code in the app to continue.</p>
</td></tr>

<tr><td style="padding:36px 48px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2f8ee;border:2px solid #cfe6c1;border-radius:16px;">
<tr><td align="center" style="padding:28px 16px;">
<p style="margin:0 0 12px;font-size:13px;line-height:1;font-weight:700;letter-spacing:3px;color:#5b9a3c;">YOUR CODE</p>
<p style="margin:0 0 16px;font-size:44px;line-height:1.1;font-weight:800;letter-spacing:12px;padding-left:12px;color:#141414;font-family:'SF Mono',Menlo,Consolas,'Courier New',monospace;">${code}</p>
<p style="margin:0;font-size:15px;line-height:1.4;color:#6b6b6b;">Expires in <strong style="color:#141414;">1 hour</strong></p>
</td></tr>
</table>
</td></tr>

<tr><td style="padding:0 48px 36px;">
<p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#4a4a4a;">Didn't ask to reset your password? You can safely ignore this email — your password won't change.</p>
<p style="margin:0;font-size:15px;line-height:1.7;color:#4a4a4a;">For your security, never share this code with anyone — KickR will never ask for it.</p>
</td></tr>

<tr><td style="border-top:1px solid #e6e8e4;padding:28px 48px 32px;">
<p style="margin:0 0 4px;font-size:14px;line-height:1.5;color:#8a8a8a;"><strong style="color:#4a4a4a;">KickR</strong> · Play more football</p>
<p style="margin:0 0 4px;font-size:14px;line-height:1.5;"><a href="${SITE_URL}" style="color:#5b9a3c;font-weight:700;text-decoration:none;">${SITE_LABEL}</a></p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#8a8a8a;">This is an automated message. Please don't reply to this email.</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

export const handler = async (event) => {
  if (event.triggerSource === 'CustomMessage_ForgotPassword') {
    // codeParameter is Cognito's "{####}" placeholder; Cognito swaps in the
    // real code after this returns, and rejects messages that omit it.
    event.response.emailSubject = 'Your KickR password reset code';
    event.response.emailMessage = forgotPasswordEmail(
      event.request.codeParameter,
    );
  }
  return event;
};
