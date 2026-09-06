import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ChatService } from './chat.service';
import { GroupsService } from '../groups/groups.service';
import { CognitoJwtVerifier } from '../auth/cognito/cognito-jwt.verifier';
import { User, UserDocument } from '../users/schemas/user.schema';

@WebSocketGateway({ cors: true, namespace: '/chat' })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private chatService: ChatService,
    private verifier: CognitoJwtVerifier,
    private groupsService: GroupsService,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

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
      (client as any).userId = user._id.toString();
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(_client: Socket) {}

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @MessageBody() data: { groupId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = (client as any).userId;
    if (!userId) return;

    const role = await this.groupsService.getMemberRole(data.groupId, userId);
    if (!role) {
      client.emit('error', { message: 'Not a member of this group' });
      return;
    }
    client.join(data.groupId);
  }

  /**
   * Broadcasts an already-persisted message to a group's room.
   *
   * Exists so the REST route can reach socket clients without reaching into
   * `server` itself: the room name and the event name are decided here, in one
   * place, so a REST-sent message is indistinguishable from a socket-sent one.
   * A client listening for `newMessage` must not care which door the message
   * came through.
   *
   * Never throws. A message that is saved but not broadcast is a missing live
   * update, recoverable by re-reading history; letting a socket failure bubble
   * would fail the HTTP request for a message that WAS stored, which is worse
   * and misleading.
   */
  broadcastMessage(groupId: string, message: unknown): void {
    try {
      // `server` is undefined if no adapter has attached yet — e.g. a request
      // arriving in the window before the gateway initialises.
      this.server?.to(groupId).emit('newMessage', message);
    } catch (err) {
      this.logger.warn(`Failed to broadcast to group ${groupId}: ${err}`);
    }
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @MessageBody() data: { groupId: string; text: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = (client as any).userId;
    if (!userId) return;

    const role = await this.groupsService.getMemberRole(data.groupId, userId);
    if (!role) return;

    const message = await this.chatService.saveMessage(
      data.groupId,
      userId,
      data.text,
    );
    this.server.to(data.groupId).emit('newMessage', {
      messageId: message._id,
      senderId: userId,
      text: message.text,
      createdAt: (message as any).createdAt,
    });
  }
}
