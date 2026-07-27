import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  AdminInitiateAuthCommand,
  CognitoIdentityProviderClient,
  SignUpCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { createHmac } from 'crypto';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { CognitoService } from '../src/auth/cognito/cognito.service';
import { User } from '../src/users/schemas/user.schema';

describe('Auth e2e (Cognito mocked)', () => {
  let app: INestApplication;
  const cognitoMock = mockClient(CognitoIdentityProviderClient);
  const userModel = {
    create: jest.fn().mockResolvedValue({}),
    findOne: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        CognitoService,
        { provide: getModelToken(User.name), useValue: userModel },
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) =>
              ({
                AWS_REGION: 'ap-southeast-1',
                COGNITO_CLIENT_ID: 'client123',
                COGNITO_CLIENT_SECRET: 'secret456',
                COGNITO_USER_POOL_ID: 'pool',
              })[k],
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  beforeEach(() => {
    cognitoMock.reset();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /auth/signup registers the email in Cognito + creates a local profile', async () => {
    cognitoMock.on(SignUpCommand).resolves({ UserSub: 'sub-xyz' });

    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        email: 'alice@b.com',
        password: 'Password123!',
      })
      .expect(201);

    const calls = cognitoMock.commandCalls(SignUpCommand);
    expect(calls.length).toBe(1);
    const input = calls[0].args[0].input;
    // Email is the Cognito Username for this pool, and the SECRET_HASH must be
    // computed over that same value or Cognito rejects the call.
    expect(input.Username).toBe('alice@b.com');
    expect(input.SecretHash).toBe(
      createHmac('sha256', 'secret456')
        .update('alice@b.com' + 'client123')
        .digest('base64'),
    );
    expect(input.UserAttributes).toEqual([
      { Name: 'email', Value: 'alice@b.com' },
    ]);

    expect(userModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        cognitoSub: 'sub-xyz',
        email: 'alice@b.com',
        name: 'alice',
      }),
    );
  });

  it('POST /auth/signup rejects invalid body via validation (Cognito not called)', async () => {
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: 'bad', password: '123' })
      .expect(400);

    expect(cognitoMock.calls().length).toBe(0);
    expect(userModel.create).not.toHaveBeenCalled();
  });

  it('POST /auth/signup strips unknown fields such as username', async () => {
    cognitoMock.on(SignUpCommand).resolves({ UserSub: 'sub-xyz' });

    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        email: 'alice@b.com',
        password: 'Password123!',
        username: 'alice',
      })
      .expect(201);

    const createCalls = userModel.create.mock.calls as Record<
      string,
      unknown
    >[][];
    expect(createCalls[0][0]).not.toHaveProperty('username');
  });

  it('POST /auth/login authenticates by email', async () => {
    cognitoMock.on(AdminInitiateAuthCommand).resolves({
      AuthenticationResult: {
        AccessToken: 'at',
        IdToken: 'it',
        RefreshToken: 'rt',
        ExpiresIn: 3600,
      },
    });
    userModel.findOne.mockReturnValue({
      lean: () => Promise.resolve({ email: 'alice@b.com' }),
    });

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'alice@b.com', password: 'Password123!' })
      .expect(200);

    // this test module omits the global transform interceptor, so the body is
    // the raw service payload rather than the { success, data } envelope
    const body = res.body as { accessToken: string };
    expect(body.accessToken).toBe('at');
    const input = cognitoMock.commandCalls(AdminInitiateAuthCommand)[0].args[0]
      .input;
    expect(input.AuthParameters?.USERNAME).toBe('alice@b.com');
  });

  it('POST /auth/login rejects a non-email identifier', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'alice', password: 'Password123!' })
      .expect(400);

    expect(cognitoMock.calls().length).toBe(0);
  });
});
