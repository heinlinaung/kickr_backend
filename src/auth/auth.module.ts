import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CognitoService } from './cognito/cognito.service';
import { CognitoJwtVerifier } from './cognito/cognito-jwt.verifier';
import { JwtStrategy } from './strategies/jwt.strategy';
import { User, UserSchema } from '../users/schemas/user.schema';

@Module({
  imports: [
    PassportModule,
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [AuthController],
  providers: [AuthService, CognitoService, CognitoJwtVerifier, JwtStrategy],
  // CognitoService is exported so AdminModule's test-data endpoint can create
  // and delete pool identities. Identity remains owned here — consumers get
  // the service, not their own client.
  exports: [PassportModule, CognitoJwtVerifier, CognitoService],
})
export class AuthModule {}
