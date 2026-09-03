import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

/**
 * Firebase Cloud Messaging, wrapped so it can never break a request.
 *
 * Every method here swallows its errors and logs them. Creating an event or
 * advancing its status must not `500` because FCM had a bad minute — the push
 * is a side effect, not part of the transaction. The `Notification` row is
 * written regardless, so the in-app list stays correct even when the push is
 * lost.
 *
 * Configuration is optional on purpose. With no service-account credentials
 * present the service starts in a disabled state and every send is a no-op, so
 * local development and CI need no Firebase project at all. That is also why
 * `enabled` is checked rather than assumed — an unconfigured environment must
 * behave like a working one, minus the push.
 */
/**
 * Coerces a service-account private key into a parseable PEM.
 *
 * The same key arrives in three shapes depending on how the environment was
 * loaded, and two of them fail without this:
 *
 * - **dotenv / a shell**: quotes are stripped and the newlines may already be
 *   real. Works as-is.
 * - **`docker run --env-file`**: Docker does **NOT** strip surrounding quotes
 *   or process escape sequences — it passes the raw characters after the first
 *   `=`. A quoted value therefore arrives with a literal `"` at each end, and
 *   that alone makes the PEM unparseable ("Failed to parse private key").
 * - **a secret manager**: usually a single line of literal backslash-n.
 *
 * So: strip one layer of matching wrapping quotes, then expand literal
 * backslash-n into real newlines. Both steps are no-ops on an already-correct
 * value, which is why this is applied unconditionally rather than sniffing
 * where the value came from.
 */
export function normalisePrivateKey(raw: string): string {
  const unquoted = raw.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
  return unquoted.replace(/\\n/g, '\n');
}

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private enabled = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const projectId = this.config.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = this.config.get<string>('FIREBASE_CLIENT_EMAIL');
    const privateKey = this.config.get<string>('FIREBASE_PRIVATE_KEY');

    if (!projectId || !clientEmail || !privateKey) {
      this.logger.warn(
        'Firebase not configured — push notifications are disabled. ' +
          'Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and ' +
          'FIREBASE_PRIVATE_KEY to enable them.',
      );
      return;
    }

    try {
      // Guarded because Nest may instantiate this more than once across test
      // modules, and initializeApp throws on a duplicate default app.
      if (!getApps().length) {
        initializeApp({
          credential: cert({
            projectId,
            clientEmail,
            privateKey: normalisePrivateKey(privateKey),
          }),
        });
      }
      this.enabled = true;
      this.logger.log(`Firebase push enabled for project ${projectId}`);
    } catch (err) {
      this.logger.error(`Firebase init failed, push disabled: ${err}`);
    }
  }

  /** True when credentials were supplied and accepted. */
  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Sends one notification to many device tokens.
   *
   * Returns the tokens FCM rejected as permanently invalid, so the caller can
   * prune them. Only `registration-token-not-registered` and
   * `invalid-argument` are treated as permanent — a network blip or a quota
   * error must NOT delete a token that is still good.
   */
  async sendToTokens(
    tokens: string[],
    payload: { title: string; body: string; data?: Record<string, string> },
  ): Promise<{ sent: number; invalidTokens: string[] }> {
    if (!this.enabled || !tokens.length) {
      return { sent: 0, invalidTokens: [] };
    }

    try {
      const res = await getMessaging().sendEachForMulticast({
        tokens,
        notification: { title: payload.title, body: payload.body },
        data: payload.data ?? {},
      });

      const invalidTokens: string[] = [];
      res.responses.forEach((response, index) => {
        if (response.success) return;
        const code = response.error?.code ?? '';
        if (
          code.includes('registration-token-not-registered') ||
          code.includes('invalid-argument')
        ) {
          invalidTokens.push(tokens[index]);
        } else {
          // Transient: keep the token, just note the miss.
          this.logger.warn(`Push failed (${code}) — token kept`);
        }
      });

      return { sent: res.successCount, invalidTokens };
    } catch (err) {
      // Swallowed by design — see the class comment.
      this.logger.error(`Push send failed entirely: ${err}`);
      return { sent: 0, invalidTokens: [] };
    }
  }
}
