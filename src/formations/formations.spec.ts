// src/formations/formations.spec.ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Formation } from './schemas/formation.schema';
import { FormationsService } from './formations.service';
import { FormationsController } from './formations.controller';

describe('Formations (global reference list)', () => {
  const chain = (rows: any[]) => ({
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(rows),
  });
  const formationModel: any = {};

  let service: FormationsService;
  let controller: FormationsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    formationModel.find = jest.fn().mockReturnValue(chain([]));

    const m = await Test.createTestingModule({
      controllers: [FormationsController],
      providers: [
        FormationsService,
        { provide: getModelToken(Formation.name), useValue: formationModel },
      ],
    }).compile();
    service = m.get(FormationsService);
    controller = m.get(FormationsController);
  });

  it('lists every row in squad-size order', async () => {
    await service.findAll();

    const query = formationModel.find.mock.results[0].value;
    expect(query.sort).toHaveBeenCalledWith({ playerCount: 1 });
  });

  it('serves only the picker fields — no _id, no timestamps', async () => {
    await service.findAll();

    const query = formationModel.find.mock.results[0].value;
    expect(query.select).toHaveBeenCalledWith('name playerCount formation -_id');
  });

  it('GET /formations delegates to the service', async () => {
    const rows = [{ name: '5P Formation', playerCount: 5, formation: ['2-2'] }];
    formationModel.find.mockReturnValue(chain(rows));

    await expect(controller.findAll()).resolves.toEqual(rows);
  });
});
