import { ConfigService } from '@nestjs/config';
import { CognitoJwtVerifier } from './cognito-jwt.verifier';

describe('CognitoJwtVerifier', () => {
  const config = {
    get: (k: string) =>
      ({
        AWS_REGION: 'ap-southeast-1',
        COGNITO_USER_POOL_ID: 'ap-southeast-1_0RV7oK5Z3',
      })[k],
  } as unknown as ConfigService;

  it('builds the correct issuer and jwks uri from config', () => {
    const v = new CognitoJwtVerifier(config);
    expect(v.issuer).toBe('https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_0RV7oK5Z3');
    expect(v.jwksUri).toBe(v.issuer + '/.well-known/jwks.json');
  });

  it('exposes a passport secretOrKeyProvider function', () => {
    const v = new CognitoJwtVerifier(config);
    expect(typeof v.secretOrKeyProvider).toBe('function');
  });
});
