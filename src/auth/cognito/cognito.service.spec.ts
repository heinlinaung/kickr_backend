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

import { mockClient } from 'aws-sdk-client-mock';
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { ConflictException } from '@nestjs/common';

describe('CognitoService.signUp', () => {
  const config = {
    get: (k: string) =>
      ({
        AWS_REGION: 'ap-southeast-1',
        COGNITO_CLIENT_ID: 'client123',
        COGNITO_CLIENT_SECRET: 'secret456',
        COGNITO_USER_POOL_ID: 'pool',
      })[k],
  } as unknown as ConfigService;
  const cognitoMock = mockClient(CognitoIdentityProviderClient);

  beforeEach(() => cognitoMock.reset());

  it('returns the Cognito sub on success', async () => {
    cognitoMock.on(SignUpCommand).resolves({ UserSub: 'sub-123' });
    const svc = new CognitoService(config);
    const sub = await svc.signUp('alice', 'p@ssw0rd', 'a@b.com');
    expect(sub).toBe('sub-123');
  });

  it('maps UsernameExistsException to 409', async () => {
    const err: any = new Error('exists');
    err.name = 'UsernameExistsException';
    cognitoMock.on(SignUpCommand).rejects(err);
    const svc = new CognitoService(config);
    await expect(svc.signUp('alice', 'p', 'a@b.com')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
