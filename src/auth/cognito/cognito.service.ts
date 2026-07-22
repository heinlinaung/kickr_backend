import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';

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
  }

  private secretHash(username: string): string {
    return createHmac('sha256', this.clientSecret)
      .update(username + this.clientId)
      .digest('base64');
  }
}
