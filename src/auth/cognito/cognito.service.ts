import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  ResendConfirmationCodeCommand,
  AdminInitiateAuthCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  AuthFlowType,
} from '@aws-sdk/client-cognito-identity-provider';
import { mapCognitoError } from './cognito.errors';

@Injectable()
export class CognitoService {
  private readonly client: CognitoIdentityProviderClient;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly userPoolId: string;

  constructor(private readonly config: ConfigService) {
    const region = this.config.get<string>('AWS_REGION') as string;
    this.client = new CognitoIdentityProviderClient({ region });
    this.clientId = this.config.get<string>('COGNITO_CLIENT_ID') as string;
    this.clientSecret = this.config.get<string>(
      'COGNITO_CLIENT_SECRET',
    ) as string;
    this.userPoolId = this.config.get<string>('COGNITO_USER_POOL_ID') as string;
    if (!region || !this.clientId || !this.clientSecret || !this.userPoolId) {
      throw new Error(
        'Missing required Cognito configuration (AWS_REGION, COGNITO_CLIENT_ID, COGNITO_CLIENT_SECRET, COGNITO_USER_POOL_ID)',
      );
    }
  }

  private secretHash(username: string): string {
    return createHmac('sha256', this.clientSecret)
      .update(username + this.clientId)
      .digest('base64');
  }

  async signUp(
    username: string,
    password: string,
    email: string,
  ): Promise<string> {
    try {
      const res = await this.client.send(
        new SignUpCommand({
          ClientId: this.clientId,
          SecretHash: this.secretHash(username),
          Username: username,
          Password: password,
          UserAttributes: [{ Name: 'email', Value: email }],
        }),
      );
      return res.UserSub as string;
    } catch (err) {
      throw mapCognitoError(err);
    }
  }

  async confirmSignUp(username: string, code: string): Promise<void> {
    try {
      await this.client.send(
        new ConfirmSignUpCommand({
          ClientId: this.clientId,
          SecretHash: this.secretHash(username),
          Username: username,
          ConfirmationCode: code,
        }),
      );
    } catch (err) {
      throw mapCognitoError(err);
    }
  }

  async resendConfirmation(username: string): Promise<void> {
    try {
      await this.client.send(
        new ResendConfirmationCodeCommand({
          ClientId: this.clientId,
          SecretHash: this.secretHash(username),
          Username: username,
        }),
      );
    } catch (err) {
      throw mapCognitoError(err);
    }
  }

  async login(username: string, password: string) {
    try {
      const res = await this.client.send(
        new AdminInitiateAuthCommand({
          UserPoolId: this.userPoolId,
          ClientId: this.clientId,
          AuthFlow: AuthFlowType.ADMIN_USER_PASSWORD_AUTH,
          AuthParameters: {
            USERNAME: username,
            PASSWORD: password,
            SECRET_HASH: this.secretHash(username),
          },
        }),
      );
      const r = res.AuthenticationResult;
      return {
        accessToken: r?.AccessToken as string,
        idToken: r?.IdToken as string,
        refreshToken: r?.RefreshToken as string,
        expiresIn: r?.ExpiresIn,
      };
    } catch (err) {
      throw mapCognitoError(err);
    }
  }

  async refresh(username: string, refreshToken: string) {
    try {
      const res = await this.client.send(
        new AdminInitiateAuthCommand({
          UserPoolId: this.userPoolId,
          ClientId: this.clientId,
          AuthFlow: AuthFlowType.REFRESH_TOKEN_AUTH,
          AuthParameters: {
            REFRESH_TOKEN: refreshToken,
            SECRET_HASH: this.secretHash(username),
          },
        }),
      );
      const r = res.AuthenticationResult;
      return {
        accessToken: r?.AccessToken as string,
        idToken: r?.IdToken as string,
        expiresIn: r?.ExpiresIn,
      };
    } catch (err) {
      throw mapCognitoError(err);
    }
  }

  async forgotPassword(username: string): Promise<void> {
    try {
      await this.client.send(
        new ForgotPasswordCommand({
          ClientId: this.clientId,
          SecretHash: this.secretHash(username),
          Username: username,
        }),
      );
    } catch (err) {
      throw mapCognitoError(err);
    }
  }

  async confirmForgotPassword(
    username: string,
    code: string,
    newPassword: string,
  ): Promise<void> {
    try {
      await this.client.send(
        new ConfirmForgotPasswordCommand({
          ClientId: this.clientId,
          SecretHash: this.secretHash(username),
          Username: username,
          ConfirmationCode: code,
          Password: newPassword,
        }),
      );
    } catch (err) {
      throw mapCognitoError(err);
    }
  }
}
