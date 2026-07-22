import {
  HttpException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

export function mapCognitoError(err: unknown): HttpException {
  const name = (err as { name?: string })?.name ?? '';
  const message = (err as { message?: string })?.message ?? 'Auth error';
  switch (name) {
    case 'UsernameExistsException':
      return new ConflictException('Username already registered');
    case 'NotAuthorizedException':
      return new UnauthorizedException('Invalid credentials');
    case 'UserNotConfirmedException':
      return new ForbiddenException('Account not confirmed');
    case 'UserNotFoundException':
      return new NotFoundException('User not found');
    case 'CodeMismatchException':
    case 'ExpiredCodeException':
      return new BadRequestException('Invalid or expired code');
    case 'InvalidPasswordException':
    case 'InvalidParameterException':
      return new BadRequestException(message);
    case 'LimitExceededException':
    case 'TooManyRequestsException':
      return new ServiceUnavailableException('Too many attempts, retry later');
    default:
      return new BadRequestException(message);
  }
}
