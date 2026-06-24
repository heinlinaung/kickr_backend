// test/groups.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './test-app.helper';
import { getModelToken } from '@nestjs/mongoose';
import { User } from '../src/users/schemas/user.schema';
import { Group } from '../src/groups/schemas/group.schema';
import { GroupMember } from '../src/groups/schemas/group-member.schema';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';

describe('Groups (e2e)', () => {
  let app: INestApplication;
  let userModel: Model<any>;
  let groupModel: Model<any>;
  let memberModel: Model<any>;
  let token: string;
  let groupId: string;

  beforeAll(async () => {
    app = await createTestApp();
    userModel = app.get(getModelToken(User.name));
    groupModel = app.get(getModelToken(Group.name));
    memberModel = app.get(getModelToken(GroupMember.name));

    await userModel.create({
      name: 'Group Owner',
      email: 'owner@test-e2e.com',
      passwordHash: await bcrypt.hash('password123', 4),
      emailVerified: true,
    });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'owner@test-e2e.com', password: 'password123' });
    expect(login.status).toBe(200);
    token = login.body.data.token;
  });

  afterAll(async () => {
    await userModel.deleteMany({ email: /@test-e2e\.com$/ });
    await groupModel.deleteMany({ name: /E2E/ });
    await memberModel.deleteMany({});
    await app.close();
  });

  it('POST /groups — creates group', async () => {
    const res = await request(app.getHttpServer())
      .post('/groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'E2E Group', description: 'Test group' });
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('name', 'E2E Group');
    groupId = res.body.data._id;
  });

  it('GET /groups/:id — returns group', async () => {
    const res = await request(app.getHttpServer())
      .get(`/groups/${groupId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('_id', groupId);
  });

  it('PATCH /groups/:id — updates group name', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/groups/${groupId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'E2E Group Updated' });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('name', 'E2E Group Updated');
  });

  it('GET /groups/:id/members — lists members (owner)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(1);
  });

  it('GET /groups/:id/invite-code — generates invite code', async () => {
    const res = await request(app.getHttpServer())
      .get(`/groups/${groupId}/invite-code`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('inviteCode');
  });

  it('POST /groups/join-by-code — another user joins via code', async () => {
    // Get the invite code
    const codeRes = await request(app.getHttpServer())
      .get(`/groups/${groupId}/invite-code`)
      .set('Authorization', `Bearer ${token}`);
    const inviteCode = codeRes.body.data.inviteCode;

    // Create another user and join
    await userModel.create({
      name: 'Joiner',
      email: 'joiner@test-e2e.com',
      passwordHash: await bcrypt.hash('password123', 4),
      emailVerified: true,
    });
    const joinerLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'joiner@test-e2e.com', password: 'password123' });
    expect(joinerLogin.status).toBe(200);
    const joinerToken = joinerLogin.body.data.token;

    const res = await request(app.getHttpServer())
      .post('/groups/join-by-code')
      .set('Authorization', `Bearer ${joinerToken}`)
      .send({ code: inviteCode });
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('message', 'Joined group successfully');
  });
});
