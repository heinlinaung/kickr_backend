import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('reports ok', () => {
    expect(controller.check()).toEqual({ status: 'ok' });
  });

  // The deploy probe only checks the status code, but this body is what a
  // human sees when debugging a failing deploy by hand, so keep it stable.
  it('returns a plain serialisable object', () => {
    expect(JSON.parse(JSON.stringify(controller.check()))).toEqual({
      status: 'ok',
    });
  });
});
