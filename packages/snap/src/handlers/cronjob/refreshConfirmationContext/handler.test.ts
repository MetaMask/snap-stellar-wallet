import { BackgroundEventMethod } from '../api';
import {
  confirmationContextRequestParams,
  createConfirmationDataContext,
} from './__fixtures__/context.fixtures';
import type {
  ConfirmationContextRefreshResult,
  IConfirmationContextRefresher,
} from './api';
import { ConfirmationContextRefresherKey } from './api';
import { RefreshConfirmationContextHandler } from './handler';
import {
  ConfirmationInterfaceKey,
  FetchStatus,
} from '../../../ui/confirmation/api';
import type { ConfirmationUXController } from '../../../ui/confirmation/controller';
import { Duration } from '../../../utils';
import { logger } from '../../../utils/logger';
import {
  getInterfaceContextIfExists,
  scheduleBackgroundEvent,
} from '../../../utils/snap';

jest.mock('../../../utils/logger');
jest.mock('../../../utils/snap', () => {
  const actual = jest.requireActual('../../../utils/snap');
  return {
    ...actual,
    getInterfaceContextIfExists: jest.fn(),
    scheduleBackgroundEvent: jest.fn().mockResolvedValue('scheduled'),
  };
});

describe('RefreshConfirmationContextHandler', () => {
  const baseContext = createConfirmationDataContext();

  function createMockRefresher(
    key: ConfirmationContextRefresherKey,
    overrides: Partial<IConfirmationContextRefresher> = {},
  ): IConfirmationContextRefresher {
    return {
      key,
      shouldFetch: jest.fn().mockReturnValue(true),
      recoveryResult: jest.fn().mockReturnValue(null),
      refresh: jest.fn().mockResolvedValue(null),
      isValidContext: jest.fn().mockReturnValue(true),
      ...overrides,
    };
  }

  function setup(refreshers: readonly IConfirmationContextRefresher[]) {
    const updateConfirmation = jest.fn().mockResolvedValue(undefined);
    const confirmationUIController = {
      updateConfirmation,
    } as unknown as ConfirmationUXController;

    const handler = new RefreshConfirmationContextHandler({
      logger,
      confirmationUIController,
      refreshers,
    });

    return { handler, updateConfirmation };
  }

  it('schedules refresh confirmation context background event', async () => {
    await RefreshConfirmationContextHandler.scheduleBackgroundEvent(
      confirmationContextRequestParams,
      Duration.FiveSeconds,
    );

    expect(scheduleBackgroundEvent).toHaveBeenCalledWith({
      method: BackgroundEventMethod.RefreshConfirmationContext,
      params: confirmationContextRequestParams,
      duration: Duration.FiveSeconds,
    });
  });

  it('returns early when the interface no longer exists', async () => {
    jest.mocked(getInterfaceContextIfExists).mockResolvedValue(null);

    const refresher = createMockRefresher(
      ConfirmationContextRefresherKey.Prices,
    );
    const { handler, updateConfirmation } = setup([refresher]);

    await handler.handle({
      jsonrpc: '2.0',
      id: '1',
      method: BackgroundEventMethod.RefreshConfirmationContext,
      params: confirmationContextRequestParams,
    });

    expect(refresher.refresh).not.toHaveBeenCalled();
    expect(updateConfirmation).not.toHaveBeenCalled();
    expect(scheduleBackgroundEvent).not.toHaveBeenCalled();
  });

  it('skips refresh when a refresher rejects the context shape', async () => {
    jest.mocked(getInterfaceContextIfExists).mockResolvedValue(baseContext);

    const refresher = createMockRefresher(
      ConfirmationContextRefresherKey.Prices,
      {
        isValidContext: jest.fn().mockReturnValue(false),
      },
    );
    const { handler, updateConfirmation } = setup([refresher]);

    await handler.handle({
      jsonrpc: '2.0',
      id: '1',
      method: BackgroundEventMethod.RefreshConfirmationContext,
      params: confirmationContextRequestParams,
    });

    expect(refresher.refresh).not.toHaveBeenCalled();
    expect(updateConfirmation).not.toHaveBeenCalled();
  });

  it('returns early when every refresher is idle', async () => {
    jest.mocked(getInterfaceContextIfExists).mockResolvedValue(baseContext);

    const refresher = createMockRefresher(
      ConfirmationContextRefresherKey.Prices,
      {
        refresh: jest.fn().mockResolvedValue(null),
      },
    );
    const { handler, updateConfirmation } = setup([refresher]);

    await handler.handle({
      jsonrpc: '2.0',
      id: '1',
      method: BackgroundEventMethod.RefreshConfirmationContext,
      params: confirmationContextRequestParams,
    });

    expect(refresher.shouldFetch).toHaveBeenCalledWith(baseContext);
    expect(refresher.refresh).toHaveBeenCalledWith(baseContext);
    expect(refresher.recoveryResult).not.toHaveBeenCalled();
    expect(updateConfirmation).not.toHaveBeenCalled();
    expect(scheduleBackgroundEvent).not.toHaveBeenCalled();
  });

  it('uses recoveryResult without calling refresh when shouldFetch is false', async () => {
    jest
      .mocked(getInterfaceContextIfExists)
      .mockResolvedValueOnce(baseContext)
      .mockResolvedValueOnce(baseContext);

    const recoveryPatch: ConfirmationContextRefreshResult = {
      result: { tokenPricesFetchStatus: FetchStatus.Fetched },
      reschedule: false,
    };

    const pricesRefresher = createMockRefresher(
      ConfirmationContextRefresherKey.Prices,
      {
        shouldFetch: jest.fn().mockReturnValue(false),
        recoveryResult: jest.fn().mockReturnValue(recoveryPatch),
      },
    );
    const scanRefresher = createMockRefresher(
      ConfirmationContextRefresherKey.Scan,
      {
        shouldFetch: jest.fn().mockReturnValue(true),
        refresh: jest.fn().mockResolvedValue(null),
      },
    );

    const { handler, updateConfirmation } = setup([
      pricesRefresher,
      scanRefresher,
    ]);

    await handler.handle({
      jsonrpc: '2.0',
      id: '1',
      method: BackgroundEventMethod.RefreshConfirmationContext,
      params: {
        ...confirmationContextRequestParams,
        refresherKeys: [
          ConfirmationContextRefresherKey.Prices,
          ConfirmationContextRefresherKey.Scan,
        ],
      },
    });

    expect(pricesRefresher.recoveryResult).toHaveBeenCalledWith(baseContext);
    expect(pricesRefresher.refresh).not.toHaveBeenCalled();
    expect(scanRefresher.shouldFetch).toHaveBeenCalledWith(baseContext);
    expect(scanRefresher.refresh).toHaveBeenCalledWith(baseContext);
    expect(scanRefresher.recoveryResult).not.toHaveBeenCalled();
    expect(updateConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        updatedContext: expect.objectContaining({
          tokenPricesFetchStatus: FetchStatus.Fetched,
        }),
      }),
    );
    expect(scheduleBackgroundEvent).not.toHaveBeenCalled();
  });

  it('merges refresher patches, re-renders, and reschedules when requested', async () => {
    const latestContext = createConfirmationDataContext({
      tokenPricesFetchStatus: FetchStatus.Fetching,
    });
    jest
      .mocked(getInterfaceContextIfExists)
      .mockResolvedValueOnce(baseContext)
      .mockResolvedValueOnce(latestContext);

    const patch: ConfirmationContextRefreshResult = {
      result: {
        tokenPricesFetchStatus: FetchStatus.Fetched,
        extraField: 'patched',
      },
      reschedule: true,
    };

    const refresher = createMockRefresher(
      ConfirmationContextRefresherKey.Prices,
      {
        refresh: jest.fn().mockResolvedValue(patch),
      },
    );
    const { handler, updateConfirmation } = setup([refresher]);

    await handler.handle({
      jsonrpc: '2.0',
      id: '1',
      method: BackgroundEventMethod.RefreshConfirmationContext,
      params: confirmationContextRequestParams,
    });

    expect(updateConfirmation).toHaveBeenCalledWith({
      interfaceId: confirmationContextRequestParams.interfaceId,
      interfaceKey: ConfirmationInterfaceKey.SignTransaction,
      updatedContext: {
        ...latestContext,
        tokenPricesFetchStatus: FetchStatus.Fetched,
        extraField: 'patched',
      },
    });
    expect(scheduleBackgroundEvent).toHaveBeenCalledWith({
      method: BackgroundEventMethod.RefreshConfirmationContext,
      params: confirmationContextRequestParams,
      duration: Duration.TwentySeconds,
    });
  });

  it('re-renders without rescheduling when no refresher requests it', async () => {
    jest
      .mocked(getInterfaceContextIfExists)
      .mockResolvedValueOnce(baseContext)
      .mockResolvedValueOnce(baseContext);

    const refresher = createMockRefresher(
      ConfirmationContextRefresherKey.Prices,
      {
        refresh: jest.fn().mockResolvedValue({
          result: { tokenPricesFetchStatus: FetchStatus.Error },
          reschedule: false,
        }),
      },
    );
    const { handler, updateConfirmation } = setup([refresher]);

    await handler.handle({
      jsonrpc: '2.0',
      id: '1',
      method: BackgroundEventMethod.RefreshConfirmationContext,
      params: confirmationContextRequestParams,
    });

    expect(updateConfirmation).toHaveBeenCalledTimes(1);
    expect(scheduleBackgroundEvent).not.toHaveBeenCalled();
  });

  it('applies patches from fulfilled refreshers when another rejects unexpectedly', async () => {
    jest
      .mocked(getInterfaceContextIfExists)
      .mockResolvedValueOnce(baseContext)
      .mockResolvedValueOnce(baseContext);

    const successful = createMockRefresher(
      ConfirmationContextRefresherKey.Prices,
      {
        refresh: jest.fn().mockResolvedValue({
          result: { tokenPricesFetchStatus: FetchStatus.Fetched },
          reschedule: false,
        }),
      },
    );
    const failing = createMockRefresher(ConfirmationContextRefresherKey.Scan, {
      refresh: jest.fn().mockRejectedValue(new Error('unexpected')),
    });

    const { handler, updateConfirmation } = setup([successful, failing]);

    await handler.handle({
      jsonrpc: '2.0',
      id: '1',
      method: BackgroundEventMethod.RefreshConfirmationContext,
      params: {
        ...confirmationContextRequestParams,
        refresherKeys: [
          ConfirmationContextRefresherKey.Prices,
          ConfirmationContextRefresherKey.Scan,
        ],
      },
    });

    expect(updateConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        updatedContext: expect.objectContaining({
          tokenPricesFetchStatus: FetchStatus.Fetched,
        }),
      }),
    );
  });

  it('does not run a refresher when its key is omitted from refresherKeys', async () => {
    jest.mocked(getInterfaceContextIfExists).mockResolvedValue(baseContext);

    const pricesRefresher = createMockRefresher(
      ConfirmationContextRefresherKey.Prices,
      {
        refresh: jest.fn().mockResolvedValue({
          result: { tokenPricesFetchStatus: FetchStatus.Fetched },
          reschedule: false,
        }),
      },
    );
    const scanRefresher = createMockRefresher(
      ConfirmationContextRefresherKey.Scan,
      {
        refresh: jest.fn().mockResolvedValue({
          result: { scanFetchStatus: FetchStatus.Fetched },
          reschedule: false,
        }),
        isValidContext: jest.fn().mockReturnValue(false),
      },
    );

    const { handler, updateConfirmation } = setup([
      pricesRefresher,
      scanRefresher,
    ]);

    await handler.handle({
      jsonrpc: '2.0',
      id: '1',
      method: BackgroundEventMethod.RefreshConfirmationContext,
      params: {
        ...confirmationContextRequestParams,
        refresherKeys: [ConfirmationContextRefresherKey.Prices],
      },
    });

    expect(pricesRefresher.refresh).toHaveBeenCalled();
    expect(scanRefresher.refresh).not.toHaveBeenCalled();
    expect(scanRefresher.isValidContext).not.toHaveBeenCalled();
    expect(updateConfirmation).toHaveBeenCalled();
  });
});
