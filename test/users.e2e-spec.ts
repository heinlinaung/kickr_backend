import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './test-app.helper';
import { getModelToken } from '@nestjs/mongoose';
import { User } from '../src/users/schemas/user.schema';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';

describe('Users (e2e)', () => {
  let app: INestApplication;
  let userModel: Model<any>;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    userModel = app.get(getModelToken(User.name));

    // Create user directly to avoid SMTP dependency
    await userModel.create({
      name: 'Profile User',
      email: 'profile@test-e2e.com',
      passwordHash: await bcrypt.hash('password123', 10),
      emailVerified: true,
    });

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'profile@test-e2e.com', password: 'password123' });
    token = loginRes.body.data.token;
  });

  afterAll(async () => {
    await userModel.deleteMany({ email: /@test-e2e\.com$/ });
    await app.close();
  });

  it('GET /users/me — 401 without token', async () => {
    const res = await request(app.getHttpServer()).get('/users/me');
    expect(res.status).toBe(401);
  });

  it('GET /users/me — returns profile with valid token', async () => {
    const res = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('email', 'profile@test-e2e.com');
    expect(res.body.data).not.toHaveProperty('passwordHash');
  });

  it('PATCH /users/me — updates display name', async () => {
    const res = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'My Display Name' });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('displayName', 'My Display Name');
  });

  it('PATCH /users/me — rejects duplicate username', async () => {
    // Set up a user with a taken username
    await userModel.updateOne(
      { email: 'profile@test-e2e.com' },
      { $set: { username: 'takenname' } },
    );

    // Create another user
    await userModel.create({
      name: 'Other User',
      email: 'other@test-e2e.com',
      passwordHash: await bcrypt.hash('password123', 10),
      emailVerified: true,
    });
    const otherLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'other@test-e2e.com', password: 'password123' });
    const otherToken = otherLogin.body.data.token;

    const res = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ username: 'takenname' });
    expect(res.status).toBe(409);
  });

  it('POST /users/me/avatar — 400 without file', async () => {
    const res = await request(app.getHttpServer())
      .post('/users/me/avatar')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});
