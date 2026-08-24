import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  ResendConfirmationCodeCommand,
  AdminInitiateAuthCommand,
  AdminConfirmSignUpCommand,
  AdminDeleteUserCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  ChangePasswordCommand,
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

  // The pool signs users in by email, so every Username/USERNAME we send is the
  // email address — and SECRET_HASH must be computed over that exact same value.
  private secretHash(email: string): string {
    return createHmac('sha256', this.clientSecret)
      .update(email + this.clientId)
      .digest('base64');
  }

  async signUp(email: string, password: string): Promise<string> {
    try {
      const res = await this.client.send(
        new SignUpCommand({
          ClientId: this.clientId,
          SecretHash: this.secretHash(email),
          Username: email,
          Password: password,
          UserAttributes: [{ Name: 'email', Value: email }],
        }),
      );
      return res.UserSub as string;
    } catch (err) {
      throw mapCognitoError(err);
    }
  }

  async confirmSignUp(email: string, code: string): Promise<void> {
    try {
      await this.client.send(
        new ConfirmSignUpCommand({
          ClientId: this.clientId,
          SecretHash: this.secretHash(email),
          Username: email,
          ConfirmationCode: code,
        }),
      );
    } catch (err) {
      throw mapCognitoError(err);
    }
  }

  /**
   * Confirm a user without the emailed code, using pool-admin credentials.
   *
   * Only for server-driven flows where no human can read an inbox — the admin
   * test-data endpoint seeds users that must be immediately usable. The normal
   * signup path still goes through `confirmSignUp` with a real code.
   */
  async adminConfirmSignUp(email: string): Promise<void> {
    try {
      await this.client.send(
        new AdminConfirmSignUpCommand({
          UserPoolId: this.userPoolId,
          Username: email,
        }),
      );
    } catch (err) {
      throw mapCognitoError(err);
    }
  }

  /**
   * Permanently delete a pool user.
   *
   * Needed because Mongo and Cognito are dual-written: dropping the User row
   * alone would strand the identity in the pool, and the email is unique there,
   * so a later signup with the same address would fail.
   */
  async adminDeleteUser(email: string): Promise<void> {
    try {
      await this.client.send(
        new AdminDeleteUserCommand({
          UserPoolId: this.userPoolId,
          Username: email,
        }),
      );
    } catch (err) {
      throw mapCognitoError(err);
    }
  }

  async resendConfirmation(email: string): Promise<void> {
    try {
      await this.client.send(
        new ResendConfirmationCodeCommand({
          ClientId: this.clientId,
          SecretHash: this.secretHash(email),
          Username: email,
        }),
      );
    } catch (err) {
      throw mapCognitoError(err);
    }
  }

  async login(email: string, password: string) {
    try {
      const res = await this.client.send(
        new AdminInitiateAuthCommand({
          UserPoolId: this.userPoolId,
          ClientId: this.clientId,
          AuthFlow: AuthFlowType.ADMIN_USER_PASSWORD_AUTH,
          AuthParameters: {
            USERNAME: email,
            PASSWORD: password,
            SECRET_HASH: this.secretHash(email),
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

  /**
   * REFRESH_TOKEN_AUTH is the one flow that does NOT take the email: Cognito
   * requires SECRET_HASH over the user's real username, which for an email
   * sign-in pool is the `sub` UUID. Passing the email here fails with
   * "Unable to verify secret hash".
   */
  async refresh(sub: string, refreshToken: string) {
    try {
      const res = await this.client.send(
        new AdminInitiateAuthCommand({
          UserPoolId: this.userPoolId,
          ClientId: this.clientId,
          AuthFlow: AuthFlowType.REFRESH_TOKEN_AUTH,
          AuthParameters: {
            REFRESH_TOKEN: refreshToken,
            SECRET_HASH: this.secretHash(sub),
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

  async forgotPassword(email: string): Promise<void> {
    try {
      await this.client.send(
        new ForgotPasswordCommand({
          ClientId: this.clientId,
          SecretHash: this.secretHash(email),
          Username: email,
        }),
      );
    } catch (err) {
      throw mapCognitoError(err);
    }
  }

  async confirmForgotPassword(
    email: string,
    code: string,
    newPassword: string,
  ): Promise<void> {
    try {
      await this.client.send(
        new ConfirmForgotPasswordCommand({
          ClientId: this.clientId,
          SecretHash: this.secretHash(email),
          Username: email,
          ConfirmationCode: code,
          Password: newPassword,
        }),
      );
    } catch (err) {
      throw mapCognitoError(err);
    }
  }

  /**
   * Changes the password of the user the access token belongs to.
   *
   * Unlike every other call here, this one carries **no ClientId and no
   * SecretHash**: the access token *is* the credential, and Cognito rejects the
   * request outright if a client secret is supplied alongside it.
   *
   * Cognito verifies `PreviousPassword` itself and answers
   * `NotAuthorizedException` when it is wrong — which `mapCognitoError` turns
   * into a `401`. That check is the whole security value of this endpoint, so it
   * is deliberately left with Cognito rather than reimplemented by re-login.
   *
   * Note this does NOT revoke the user's other sessions: existing refresh
   * tokens keep working until they expire. Revoking them needs a separate
   * GlobalSignOut, which also ends the caller's own session.
   */
  async changePassword(
    accessToken: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    try {
      await this.client.send(
        new ChangePasswordCommand({
          AccessToken: accessToken,
          PreviousPassword: currentPassword,
          ProposedPassword: newPassword,
        }),
      );
    } catch (err) {
      throw mapCognitoError(err);
    }
  }
}
