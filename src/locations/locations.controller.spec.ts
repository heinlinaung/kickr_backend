import { Test } from '@nestjs/testing';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';

describe('LocationsController', () => {
  let controller: LocationsController;

  const svc = {
    create: jest.fn().mockResolvedValue({ _id: 'l1' }),
    listMine: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue({ _id: 'l1' }),
    update: jest.fn().mockResolvedValue({ _id: 'l1' }),
    remove: jest.fn().mockResolvedValue({ message: 'Location deleted' }),
  };

  const user = { _id: 'u1' } as any;

  beforeEach(async () => {
    jest.clearAllMocks();
    const m = await Test.createTestingModule({
      controllers: [LocationsController],
      providers: [{ provide: LocationsService, useValue: svc }],
    }).compile();
    controller = m.get(LocationsController);
  });

  it('POST / creates with the caller as owner', async () => {
    const dto = { name: 'Pitch', lat: 13.7563, lng: 100.5018 } as any;
    await controller.create(user, dto);
    expect(svc.create).toHaveBeenCalledWith('u1', dto);
  });

  it('GET / lists only the callers locations', async () => {
    await controller.listMine(user);
    expect(svc.listMine).toHaveBeenCalledWith('u1');
  });

  it('GET /:id delegates to findById', async () => {
    await controller.findById('l1');
    expect(svc.findById).toHaveBeenCalledWith('l1');
  });

  it('PATCH /:id passes id, caller id and dto', async () => {
    const dto = { name: 'Renamed' } as any;
    await controller.update(user, 'l1', dto);
    expect(svc.update).toHaveBeenCalledWith('l1', 'u1', dto);
  });

  it('DELETE /:id passes id and caller id', async () => {
    await controller.remove(user, 'l1');
    expect(svc.remove).toHaveBeenCalledWith('l1', 'u1');
  });
});
