import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy.validate (Cognito)', () => {
  const verifier = {
    issuer: 'https://issuer',
    algorithms: ['RS256'],
    secretOrKeyProvider: (_req: any, _tok: any, done: any) => done(null, 'key'),
  };

  it('loads the Mongo user by cognitoSub from the token claim', async () => {
    const lean = jest.fn().mockResolvedValue({ _id: 'x', cognitoSub: 'sub-1' });
    const userModel = { findOne: jest.fn(() => ({ select: () => ({ lean }) })) };
    const strat = new JwtStrategy(verifier as any, userModel as any);
    const user = await strat.validate({ sub: 'sub-1', username: 'alice' });
    expect(userModel.findOne).toHaveBeenCalledWith({ cognitoSub: 'sub-1' });
    expect(user).toEqual(expect.objectContaining({ cognitoSub: 'sub-1' }));
  });

  it('rejects when no user matches', async () => {
    const lean = jest.fn().mockResolvedValue(null);
    const userModel = { findOne: jest.fn(() => ({ select: () => ({ lean }) })) };
    const strat = new JwtStrategy(verifier as any, userModel as any);
    await expect(strat.validate({ sub: 'nope', username: 'x' })).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
