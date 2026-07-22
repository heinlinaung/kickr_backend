import { createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { CognitoService } from './cognito.service';

function expectedHash(username: string, clientId: string, secret: string) {
  return createHmac('sha256', secret)
    .update(username + clientId)
    .digest('base64');
}

describe('CognitoService.secretHash', () => {
  const config = {
    get: (k: string) =>
      ({
        AWS_REGION: 'ap-southeast-1',
        COGNITO_USER_POOL_ID: 'ap-southeast-1_0RV7oK5Z3',
        COGNITO_CLIENT_ID: 'client123',
        COGNITO_CLIENT_SECRET: 'secret456',
      })[k],
  } as unknown as ConfigService;

  it('computes the Cognito SECRET_HASH for a username', () => {
    const svc = new CognitoService(config);
    const hash = (svc as any).secretHash('alice');
    expect(hash).toBe(expectedHash('alice', 'client123', 'secret456'));
  });
});
