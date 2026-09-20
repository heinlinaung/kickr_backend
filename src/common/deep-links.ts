// src/common/deep-links.ts
/**
 * Deep links into the mobile app (custom URL scheme).
 *
 * The scheme is registered by the Flutter app (`kickrsport://`), and the
 * paths here must match its route table — the app is the authority on the
 * format, this module just keeps the server's copies in one place so the QR
 * response and the invite landing page cannot drift apart.
 *
 * A custom scheme only opens for users who HAVE the app: an https link is
 * still what QR codes encode (a scheme URL in a camera scan dead-ends when
 * the app is missing). These are the secondary hop — the landing page and
 * the API hand them to a device so the OS can jump into the app.
 */

/** The group details screen: `kickrsport://group/<groupId>`. */
export function groupDeepLink(groupId: string): string {
  return `kickrsport://group/${groupId}`;
}
