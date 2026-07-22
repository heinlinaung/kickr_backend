import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
} from '@aws-sdk/client-cognito-identity-provider';
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

  it('POST /auth/signup creates cognito user + local profile', async () => {
    cognitoMock.on(SignUpCommand).resolves({ UserSub: 'sub-xyz' });

    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        username: 'alice',
        name: 'Alice',
        email: 'a@b.com',
        password: 'Password123!',
      })
      .expect(201);

    expect(cognitoMock.commandCalls(SignUpCommand).length).toBe(1);
    expect(userModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ cognitoSub: 'sub-xyz', username: 'alice' }),
    );
  });

  it('POST /auth/signup rejects invalid body via validation (Cognito not called)', async () => {
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ username: 'a', name: 'A', email: 'bad', password: '123' })
      .expect(400);

    expect(cognitoMock.calls().length).toBe(0);
    expect(userModel.create).not.toHaveBeenCalled();
  });
});
