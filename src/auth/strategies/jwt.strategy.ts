import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  User,
  UserDocument,
  USER_SENSITIVE_PROJECTION,
} from '../../users/schemas/user.schema';
import {
  CognitoJwtVerifier,
  CognitoAccessClaims,
} from '../cognito/cognito-jwt.verifier';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    verifier: CognitoJwtVerifier,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      algorithms: [...verifier.algorithms],
      issuer: verifier.issuer,
      secretOrKeyProvider: verifier.secretOrKeyProvider,
    });
  }

  async validate(payload: CognitoAccessClaims) {
    // Reject ID/refresh tokens — only Cognito access tokens authorize the API,
    // matching the WebSocket gateway's policy.
    if (payload.token_use !== 'access') throw new UnauthorizedException();
    const user = await this.userModel
      .findOne({ cognitoSub: payload.sub })
      .select(USER_SENSITIVE_PROJECTION)
      .lean();
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
