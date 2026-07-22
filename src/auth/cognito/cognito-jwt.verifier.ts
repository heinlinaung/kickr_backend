import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verify as jwtVerify, decode as jwtDecode } from 'jsonwebtoken';
import { JwksClient, passportJwtSecret } from 'jwks-rsa';

export interface CognitoAccessClaims {
  sub: string;
  username: string;
  /** Cognito token category; must be 'access' for API/WS auth (reject 'id'). */
  token_use?: string;
  [k: string]: unknown;
}

@Injectable()
export class CognitoJwtVerifier {
  readonly issuer: string;
  readonly jwksUri: string;
  readonly algorithms = ['RS256'] as const;
  private readonly jwksClient: JwksClient;

  /** Provider for passport-jwt (HTTP strategy). */
  secretOrKeyProvider!: ReturnType<typeof passportJwtSecret>;

  constructor(config: ConfigService) {
    const region = config.get<string>('AWS_REGION');
    const poolId = config.get<string>('COGNITO_USER_POOL_ID');
    if (!region || !poolId) {
      throw new Error(
        'Missing Cognito config (AWS_REGION, COGNITO_USER_POOL_ID)',
      );
    }
    this.issuer = `https://cognito-idp.${region}.amazonaws.com/${poolId}`;
    this.jwksUri = `${this.issuer}/.well-known/jwks.json`;
    // Two JWKS clients intentionally: `jwksClient` backs the imperative verify()
    // path (WebSocket), while passportJwtSecret() wraps its own internal client
    // (not exposed) for the passport-jwt HTTP strategy. Both are cached +
    // rate-limited against the same URI; sharing one isn't possible without
    // reaching into passport-jwt-secret internals.
    this.jwksClient = new JwksClient({
      jwksUri: this.jwksUri,
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
    });
    this.secretOrKeyProvider = passportJwtSecret({
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
      jwksUri: this.jwksUri,
    });
  }

  /** Standalone verify for non-passport contexts (e.g. WebSocket handshake). */
  async verify(token: string): Promise<CognitoAccessClaims> {
    const decoded = jwtDecode(token, { complete: true });
    const kid =
      typeof decoded === 'object' && decoded !== null
        ? decoded.header?.kid
        : undefined;
    if (!kid) throw new UnauthorizedException('Invalid token');
    const key = await this.jwksClient.getSigningKey(kid);
    const publicKey = key.getPublicKey();
    try {
      return jwtVerify(token, publicKey, {
        algorithms: ['RS256'],
        issuer: this.issuer,
      }) as unknown as CognitoAccessClaims;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
