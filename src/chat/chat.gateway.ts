import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ChatService } from './chat.service';
import { GroupsService } from '../groups/groups.service';
import { CognitoJwtVerifier } from '../auth/cognito/cognito-jwt.verifier';
import { User, UserDocument } from '../users/schemas/user.schema';

@WebSocketGateway({ cors: true, namespace: '/chat' })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
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
