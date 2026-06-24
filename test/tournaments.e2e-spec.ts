// test/tournaments.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './test-app.helper';
import { getModelToken } from '@nestjs/mongoose';
import { User } from '../src/users/schemas/user.schema';
import { Tournament } from '../src/tournaments/schemas/tournament.schema';
import { TournamentTeam } from '../src/tournaments/schemas/tournament-team.schema';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';

describe('Tournaments (e2e)', () => {
  let app: INestApplication;
  let userModel: Model<any>;
  let tournamentModel: Model<any>;
  let teamModel: Model<any>;
  let token: string;
  let userId: string;
  let tournamentId: string;

  beforeAll(async () => {
    app = await createTestApp();
    userModel = app.get(getModelToken(User.name));
    tournamentModel = app.get(getModelToken(Tournament.name));
    teamModel = app.get(getModelToken(TournamentTeam.name));

    const user = await userModel.create({
      name: 'Tournament Creator',
      email: 'tournament@test-e2e.com',
      passwordHash: await bcrypt.hash('password123', 4),
      emailVerified: true,
    });
    userId = user._id.toString();

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'tournament@test-e2e.com', password: 'password123' });
    expect(login.status).toBe(200);
    token = login.body.data.token;
  });

  afterAll(async () => {
    await userModel.deleteMany({ email: /@test-e2e\.com$/ });
    await tournamentModel.deleteMany({ title: /E2E/ });
    await teamModel.deleteMany({});
    await app.close();
  });

  it('POST /tournaments — creates tournament', async () => {
    const res = await request(app.getHttpServer())
      .post('/tournaments')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'E2E Cup', type: 'knockout', maxTeams: 8 });
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('title', 'E2E Cup');
    tournamentId = res.body.data._id;
  });

  it('GET /tournaments/:id — returns tournament with teams and matches', async () => {
    const res = await request(app.getHttpServer())
      .get(`/tournaments/${tournamentId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('tournament');
    expect(res.body.data).toHaveProperty('teams');
    expect(res.body.data).toHaveProperty('matches');
    expect(Array.isArray(res.body.data.teams)).toBe(true);
    expect(Array.isArray(res.body.data.matches)).toBe(true);
  });

  it('POST /tournaments/:id/teams — registers team', async () => {
    const res = await request(app.getHttpServer())
      .post(`/tournaments/${tournamentId}/teams`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'E2E FC', players: [userId] });
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('name', 'E2E FC');
  });

  it('POST /tournaments — rejects invalid type', async () => {
    const res = await request(app.getHttpServer())
      .post('/tournaments')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Bad Tournament', type: 'roundrobin', maxTeams: 4 });
    expect(res.status).toBe(400);
  });
});
