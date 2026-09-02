import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CognitoJwtVerifier } from '../auth/cognito/cognito-jwt.verifier';
import { User, UserDocument } from '../users/schemas/user.schema';

/**
 * Live notification delivery, for clients that are currently open.
 *
 * Its own namespace rather than a channel on `/chat`: chat rooms are joined per
 * group, whereas a notification is addressed to a *user* across every group
 * they belong to. Sharing the namespace would mean a client had to be in a
 * group room to hear about an event, which is the opposite of what is wanted.
 *
 * Each socket joins one room named after the user id, so a fan-out is a single
 * emit per recipient regardless of how many devices they have open — socket.io
 * handles the duplication.
 *
 * Complements FCM rather than replacing it: this reaches an app in the
 * foreground instantly, push reaches one that is backgrounded or closed. Both
 * fire, and the client dedupes on the notification id.
 */
@WebSocketGateway({ cors: true, namespace: '/notifications' })
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly verifier: CognitoJwtVerifier,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  /**
   * Authenticates the handshake and puts the socket in its user's room.
   *
   * Same contract as ChatGateway: an access token, never an id token. An
   * unauthenticated socket is disconnected rather than left idle, so it cannot
   * sit in the room list consuming a slot.
   */
  async handleConnection(client: Socket) {
    try {
      const token = (client.handshake.auth?.token ||
        client.handshake.query.token) as string;
      const claims = await this.verifier.verify(token);
      if (claims.token_use !== 'access') {
        client.disconnect();
        return;
      }

      const user = await this.userModel
        .findOne({ cognitoSub: claims.sub })
        .select('_id')
        .lean();
      if (!user) {
        client.disconnect();
        return;
      }

      const room = String(user._id);
      client.data.userId = room;
      await client.join(room);
    } catch {
      // Never log the token or the error detail — a malformed JWT is a common
      // client bug and its contents are a credential.
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    // socket.io removes the socket from its rooms automatically; nothing to
    // clean up. Defined because OnGatewayDisconnect requires it.
    void client;
  }

  /**
   * Pushes one notification to every open socket of one user.
   *
   * Returns nothing and throws nothing: if the user has no socket connected
   * this is a silent no-op, which is the normal case rather than an error.
   */
  emitToUser(userId: string, notification: unknown) {
    // `server` is undefined until the gateway is initialised — in a unit test
    // that instantiates the class directly, for instance.
    if (!this.server) return;
    try {
      this.server.to(userId).emit('notification', notification);
    } catch (err) {
      this.logger.error(`Socket emit failed for ${userId}: ${err}`);
    }
  }
}
