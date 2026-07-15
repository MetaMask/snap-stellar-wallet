import { BackgroundEventMethod } from './api';
import { SyncAssetsHandler } from './syncAssets';
import { KnownCaip2ChainId } from '../../api';
import type { SynchronizeService } from '../../services/sync/SynchronizeService';
import { logger } from '../../utils/logger';

jest.mock('../../utils/logger');

describe('SyncAssetsHandler', () => {
  const setupTest = () => {
    const synchronizeService: jest.Mocked<
      Pick<SynchronizeService, 'synchronizeAssets'>
    > = {
      synchronizeAssets: jest.fn(),
    };

    const handler = new SyncAssetsHandler({
      logger,
      synchronizeService: synchronizeService as unknown as SynchronizeService,
    });

    return {
      handler,
      synchronizeService,
    };
  };

  it('synchronizes assets on mainnet', async () => {
    const { handler, synchronizeService } = setupTest();

    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: BackgroundEventMethod.SynchronizeAssets,
    };

    await handler.handle(request);

    expect(synchronizeService.synchronizeAssets).toHaveBeenCalledWith(
      KnownCaip2ChainId.Mainnet,
    );
  });
});
