import { Test } from '@nestjs/testing';
import { ImageKitService, IMAGEKIT_CLIENT } from './imagekit.service';

describe('ImageKitService', () => {
  let service: ImageKitService;
  const ikClient = {
    upload: jest.fn(),
    deleteFile: jest.fn(),
  };
  beforeEach(async () => {
    jest.clearAllMocks();
    const m = await Test.createTestingModule({
      providers: [
        ImageKitService,
        { provide: IMAGEKIT_CLIENT, useValue: ikClient },
      ],
    }).compile();
    service = m.get(ImageKitService);
  });

  it('uploads a buffer and returns url + fileId', async () => {
    ikClient.upload.mockResolvedValue({ url: 'https://ik.imagekit.io/kickr/profiles/x.jpg', fileId: 'fid1' });
    const res = await service.upload(Buffer.from('abc'), 'x.jpg', 'profiles');
    expect(ikClient.upload).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'x.jpg', folder: '/profiles' }));
    expect(res).toEqual({ url: 'https://ik.imagekit.io/kickr/profiles/x.jpg', fileId: 'fid1' });
  });

  it('deleteFile ignores a missing fileId (no-op) and calls SDK when present', async () => {
    await service.deleteFile('');
    expect(ikClient.deleteFile).not.toHaveBeenCalled();
    ikClient.deleteFile.mockResolvedValue({});
    await service.deleteFile('fid1');
    expect(ikClient.deleteFile).toHaveBeenCalledWith('fid1');
  });
});
