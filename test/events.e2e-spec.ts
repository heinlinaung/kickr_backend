// test/events.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './test-app.helper';
import { getModelToken } from '@nestjs/mongoose';
import { User } from '../src/users/schemas/user.schema';
import { Event } from '../src/events/schemas/event.schema';
import { EventPlayer } from '../src/events/schemas/event-player.schema';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';

describe('Events (e2e)', () => {
  let app: INestApplication;
  let userModel: Model<any>;
  let eventModel: Model<any>;
  let playerModel: Model<any>;
  let token: string;
  let eventId: string;

  beforeAll(async () => {
    app = await createTestApp();
    userModel = app.get(getModelToken(User.name));
    eventModel = app.get(getModelToken(Event.name));
    playerModel = app.get(getModelToken(EventPlayer.name));

    await userModel.create({
      name: 'Event Creator',
      email: 'eventcreator@test-e2e.com',
      passwordHash: await bcrypt.hash('password123', 4),
      emailVerified: true,
    });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'eventcreator@test-e2e.com', password: 'password123' });
    expect(login.status).toBe(200);
    token = login.body.data.token;
  });

  afterAll(async () => {
    await userModel.deleteMany({ email: /@test-e2e\.com$/ });
    await eventModel.deleteMany({ title: /E2E/ });
    await playerModel.deleteMany({});
    await app.close();
  });

  it('POST /events — creates event', async () => {
    const res = await request(app.getHttpServer())
      .post('/events')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'E2E Match',
        date: new Date(Date.now() + 86400000).toISOString(),
        isPublic: true,
        maxPlayers: 12,
      });
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('title', 'E2E Match');
    eventId = res.body.data._id;
  });

  it('GET /events — lists public events', async () => {
    const res = await request(app.getHttpServer())
      .get('/events')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /events/:id — returns event', async () => {
    const res = await request(app.getHttpServer())
      .get(`/events/${eventId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('_id', eventId);
  });

  it('POST /events/:id/join — joins event', async () => {
    const res = await request(app.getHttpServer())
      .post(`/events/${eventId}/join`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('message', 'Joined event successfully');
  });

  it('POST /events/:id/join — rejects duplicate join', async () => {
    const res = await request(app.getHttpServer())
      .post(`/events/${eventId}/join`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(409);
  });

  it('GET /events/:id/players — lists joined players', async () => {
    const res = await request(app.getHttpServer())
      .get(`/events/${eventId}/players`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('DELETE /events/:id/join — leaves event', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/events/${eventId}/join`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('message', 'Left event successfully');
  });
});
