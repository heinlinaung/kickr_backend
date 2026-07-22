import { ChatGateway } from './chat.gateway';

function mockSocket(token?: string) {
  return {
    handshake: { auth: { token }, query: {} },
    disconnect: jest.fn(),
    join: jest.fn(),
    emit: jest.fn(),
  } as any;
}

describe('ChatGateway.handleConnection (Cognito)', () => {
  const verifier = { verify: jest.fn() };
  const userModel = { findOne: jest.fn() };
  const chatService = {} as any;
  const groupsService = {} as any;

  function makeGateway() {
    return new ChatGateway(chatService, verifier as any, groupsService, userModel as any);
  }

  beforeEach(() => jest.clearAllMocks());

  it('sets client.userId to the Mongo _id resolved from cognitoSub', async () => {
    verifier.verify.mockResolvedValue({ sub: 'cog-1', username: 'alice', token_use: 'access' });
    userModel.findOne.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ _id: 'mongo-1', cognitoSub: 'cog-1' }) }) });
    const gw = makeGateway();
    const client = mockSocket('good-token');
    await gw.handleConnection(client);
    expect(verifier.verify).toHaveBeenCalledWith('good-token');
    expect(userModel.findOne).toHaveBeenCalledWith({ cognitoSub: 'cog-1' });
    expect(client.userId).toBe('mongo-1');
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects when the token is invalid', async () => {
    verifier.verify.mockRejectedValue(new Error('bad'));
    const gw = makeGateway();
    const client = mockSocket('bad-token');
    await gw.handleConnection(client);
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('disconnects when token_use is not access (e.g. id token)', async () => {
    verifier.verify.mockResolvedValue({ sub: 'cog-1', username: 'alice', token_use: 'id' });
    const gw = makeGateway();
    const client = mockSocket('id-token');
    await gw.handleConnection(client);
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('disconnects when no local user matches the cognitoSub', async () => {
    verifier.verify.mockResolvedValue({ sub: 'ghost', username: 'x', token_use: 'access' });
    userModel.findOne.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(null) }) });
    const gw = makeGateway();
    const client = mockSocket('token');
    await gw.handleConnection(client);
    expect(client.disconnect).toHaveBeenCalled();
  });
});
