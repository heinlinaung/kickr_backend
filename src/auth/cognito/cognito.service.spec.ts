import { createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { CognitoService } from './cognito.service';

function expectedHash(email: string, clientId: string, secret: string) {
  return createHmac('sha256', secret)
    .update(email + clientId)
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

  it('computes the Cognito SECRET_HASH for an email', () => {
    const svc = new CognitoService(config);
    const hash = (svc as any).secretHash('alice@b.com');
    expect(hash).toBe(expectedHash('alice@b.com', 'client123', 'secret456'));
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
    const sub = await svc.signUp('alice@b.com', 'p@ssw0rd');
    expect(sub).toBe('sub-123');
    const input = cognitoMock.commandCalls(SignUpCommand)[0].args[0].input;
    expect(input.Username).toBe('alice@b.com');
    expect(input.UserAttributes).toEqual([
      { Name: 'email', Value: 'alice@b.com' },
    ]);
  });

  it('maps UsernameExistsException to 409', async () => {
    const err = Object.assign(new Error('exists'), {
      name: 'UsernameExistsException',
    });
    cognitoMock.on(SignUpCommand).rejects(err);
    const svc = new CognitoService(config);
    await expect(svc.signUp('alice@b.com', 'p')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
