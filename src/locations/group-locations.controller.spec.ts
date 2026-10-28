import { Test } from '@nestjs/testing';
import { GroupLocationsController } from './group-locations.controller';
import { LocationsService } from './locations.service';

describe('GroupLocationsController', () => {
  let controller: GroupLocationsController;

  const svc = {
    createForGroup: jest.fn().mockResolvedValue({ _id: 'l1' }),
    listForGroup: jest.fn().mockResolvedValue([]),
    findForGroup: jest.fn().mockResolvedValue({ _id: 'l1' }),
    updateForGroup: jest.fn().mockResolvedValue({ _id: 'l1' }),
    removeForGroup: jest
      .fn()
      .mockResolvedValue({ message: 'Location deleted' }),
  };

  const user = { _id: 'u1' } as any;

  beforeEach(async () => {
    jest.clearAllMocks();
    const m = await Test.createTestingModule({
      controllers: [GroupLocationsController],
      providers: [{ provide: LocationsService, useValue: svc }],
    }).compile();
    controller = m.get(GroupLocationsController);
  });

  it('POST / passes group id, caller id and dto', async () => {
    const dto = { name: 'Pitch', lat: 13.7563, lng: 100.5018 } as any;
    await controller.create('g1', user, dto);
    expect(svc.createForGroup).toHaveBeenCalledWith('g1', 'u1', dto);
  });

  it('GET / lists the group locations', async () => {
    await controller.list('g1');
    expect(svc.listForGroup).toHaveBeenCalledWith('g1');
  });

  it('GET /:locationId delegates to findForGroup', async () => {
    await controller.findOne('g1', 'l1');
    expect(svc.findForGroup).toHaveBeenCalledWith('g1', 'l1');
  });

  it('PATCH /:locationId passes ids, caller id and dto', async () => {
    const dto = { name: 'Renamed' } as any;
    await controller.update('g1', 'l1', user, dto);
    expect(svc.updateForGroup).toHaveBeenCalledWith('g1', 'l1', 'u1', dto);
  });

  it('DELETE /:locationId passes ids and caller id', async () => {
    await controller.remove('g1', 'l1', user);
    expect(svc.removeForGroup).toHaveBeenCalledWith('g1', 'l1', 'u1');
  });
});
