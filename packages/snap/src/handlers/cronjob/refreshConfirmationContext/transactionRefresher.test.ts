import { Networks } from '@stellar/stellar-sdk';

import { createConfirmationDataContext } from './__fixtures__/context.fixtures';
import { ConfirmationContextRefresherKey } from './api';
import { ConfirmationTransactionRefresher } from './transactionRefresher';
import { KnownCaip2ChainId } from '../../../api';
import type { AssetMetadataService } from '../../../services/asset-metadata';
import type { TransactionService } from '../../../services/transaction';
import type { MockClassicOperation } from '../../../services/transaction/__mocks__/transaction.fixtures';
import { buildMockClassicTransaction } from '../../../services/transaction/__mocks__/transaction.fixtures';
import { FetchStatus } from '../../../ui/confirmation/api';
import { getSlip44AssetId } from '../../../utils';
import { logger } from '../../../utils/logger';
import type { AccountResolver } from '../../accountResolver';
import {
  ChangeTrustOptAction,
  ClientRequestMethod,
} from '../../clientRequest/api';

jest.mock('../../../utils/logger');

describe('ConfirmationTransactionRefresher', () => {
  const scope = KnownCaip2ChainId.Testnet;
  const accountId = '11111111-1111-4111-8111-111111111111';
  const toAddress = 'GDPMFLKUGASUTWBN2XGYYKD27QGHCYH4BUFUTER4L23INYQ4JHDWFOIE';

  const paymentOperations: MockClassicOperation[] = [
    {
      type: 'payment',
      params: { destination: toAddress, asset: 'native', amount: '1' },
    },
  ];

  const transaction = buildMockClassicTransaction(paymentOperations, {
    networkPassphrase: Networks.TESTNET,
  });
  const transactionXdr = transaction.getRaw().toXDR();

  // The envelope previously held in the security-scan request. Each refresh
  // cycle rebuilds the transaction and swaps this for the freshly rebuilt one.
  const scanTransactionXdr = buildMockClassicTransaction(paymentOperations, {
    networkPassphrase: Networks.TESTNET,
    timeout: 600,
  })
    .getRaw()
    .toXDR();

  const sendRequest = {
    jsonrpc: '2.0' as const,
    id: 1,
    method: ClientRequestMethod.ConfirmSend,
    params: {
      scope,
      accountId,
      fromAccountId: accountId,
      toAddress,
      assetId: getSlip44AssetId(scope),
      amount: '1',
    },
  };

  const classicAssetId = `stellar:testnet/asset:USDC-${toAddress}`;

  const changeTrustAddRequest = {
    jsonrpc: '2.0' as const,
    id: 1,
    method: ClientRequestMethod.ChangeTrustOpt,
    params: {
      scope,
      accountId,
      assetId: classicAssetId,
      action: ChangeTrustOptAction.Add,
      limit: '1000',
    },
  };

  const changeTrustDeleteRequest = {
    jsonrpc: '2.0' as const,
    id: 1,
    method: ClientRequestMethod.ChangeTrustOpt,
    params: {
      scope,
      accountId,
      assetId: classicAssetId,
      action: ChangeTrustOptAction.Delete,
    },
  };

  function setup() {
    const accountResolver = {
      resolveAccount: jest
        .fn()
        .mockResolvedValue({ onChainAccount: { accountId, scope } }),
    };
    const transactionService = {
      createValidatedSendTransaction: jest.fn().mockResolvedValue(transaction),
      createValidatedChangeTrustTransaction: jest
        .fn()
        .mockResolvedValue(transaction),
    };
    const assetMetadataService = {
      resolve: jest.fn().mockResolvedValue({ units: [{ decimals: 7 }] }),
    };

    const refresher = new ConfirmationTransactionRefresher({
      logger,
      accountResolver: accountResolver as unknown as AccountResolver,
      transactionService: transactionService as unknown as TransactionService,
      assetMetadataService:
        assetMetadataService as unknown as AssetMetadataService,
    });

    return {
      refresher,
      accountResolver,
      transactionService,
      assetMetadataService,
    };
  }

  function createTransactionContext(
    overrides: Parameters<typeof createConfirmationDataContext>[0] = {},
  ) {
    return createConfirmationDataContext({
      transaction: transactionXdr,
      transactionsFetchStatus: FetchStatus.Fetched,
      accountId,
      scope,
      origin: 'https://metamask.io',
      request: sendRequest,
      ...overrides,
    });
  }

  it('uses the transaction refresher key', () => {
    const { refresher } = setup();
    expect(refresher.key).toBe(ConfirmationContextRefresherKey.Transaction);
  });

  it('re-validates the send transaction and propagates the rebuilt envelope to security scan', async () => {
    const { refresher, transactionService } = setup();

    const result = await refresher.refresh(createTransactionContext());

    expect(
      transactionService.createValidatedSendTransaction,
    ).toHaveBeenCalledWith({
      onChainAccount: { accountId, scope },
      scope,
      assetId: sendRequest.params.assetId,
      destination: toAddress,
      amount: expect.anything(),
    });
    expect(result).toStrictEqual({
      result: {
        securityScanRequest: {
          accountAddress: accountId,
          origin: 'https://metamask.io',
          scope,
          transaction: transactionXdr,
        },
      },
      reschedule: false,
    });
  });

  it('marks the transaction invalid when re-validation throws', async () => {
    const { refresher, transactionService } = setup();
    transactionService.createValidatedSendTransaction.mockRejectedValueOnce(
      new Error('insufficient balance'),
    );

    const result = await refresher.refresh(createTransactionContext());

    expect(result).toStrictEqual({
      result: { transactionsFetchStatus: FetchStatus.Error },
      reschedule: false,
    });
  });

  it('re-validates a change-trust opt-in transaction', async () => {
    const { refresher, transactionService } = setup();

    const result = await refresher.refresh(
      createTransactionContext({ request: changeTrustAddRequest }),
    );

    expect(
      transactionService.createValidatedChangeTrustTransaction,
    ).toHaveBeenCalledWith({
      onChainAccount: { accountId, scope },
      scope,
      assetId: classicAssetId,
      limit: '1000',
    });
    expect(
      transactionService.createValidatedSendTransaction,
    ).not.toHaveBeenCalled();
    expect(result).toStrictEqual({
      result: {
        securityScanRequest: {
          accountAddress: accountId,
          origin: 'https://metamask.io',
          scope,
          transaction: transactionXdr,
        },
      },
      reschedule: false,
    });
  });

  it('re-validates a change-trust opt-out transaction with a zero limit', async () => {
    const { refresher, transactionService } = setup();

    await refresher.refresh(
      createTransactionContext({ request: changeTrustDeleteRequest }),
    );

    expect(
      transactionService.createValidatedChangeTrustTransaction,
    ).toHaveBeenCalledWith({
      onChainAccount: { accountId, scope },
      scope,
      assetId: classicAssetId,
      limit: '0',
    });
  });

  it('renews the security-scan transaction with the rebuilt envelope', async () => {
    const { refresher } = setup();
    const securityScanRequest = {
      accountAddress: toAddress,
      origin: 'https://dapp.example',
      scope,
      transaction: scanTransactionXdr,
    };

    const result = await refresher.refresh(
      createTransactionContext({ securityScanRequest }),
    );

    expect(result).toStrictEqual({
      result: {
        securityScanRequest: {
          ...securityScanRequest,
          transaction: transactionXdr,
        },
      },
      reschedule: false,
    });
  });

  it('renews the security-scan transaction for change-trust flows', async () => {
    const { refresher } = setup();
    const securityScanRequest = {
      accountAddress: toAddress,
      origin: 'https://dapp.example',
      scope,
      transaction: scanTransactionXdr,
    };

    const result = await refresher.refresh(
      createTransactionContext({
        request: changeTrustAddRequest,
        securityScanRequest,
      }),
    );

    expect(result).toStrictEqual({
      result: {
        securityScanRequest: {
          ...securityScanRequest,
          transaction: transactionXdr,
        },
      },
      reschedule: false,
    });
  });

  it('rebuilds when the stored envelope has expired', async () => {
    const { refresher, transactionService } = setup();
    const mockNow = 1_700_000_000_000;
    jest.useFakeTimers();
    jest.setSystemTime(mockNow);

    try {
      const expiredTransaction = buildMockClassicTransaction(
        [
          {
            type: 'payment',
            params: { destination: toAddress, asset: 'native', amount: '1' },
          },
        ],
        { networkPassphrase: Networks.TESTNET, timeout: 1 },
      );
      jest.advanceTimersByTime(2000);

      const result = await refresher.refresh(
        createTransactionContext({
          transaction: expiredTransaction.getRaw().toXDR(),
        }),
      );

      expect(
        transactionService.createValidatedSendTransaction,
      ).toHaveBeenCalled();
      expect(result).toStrictEqual({
        result: {
          securityScanRequest: {
            accountAddress: accountId,
            origin: 'https://metamask.io',
            scope,
            transaction: transactionXdr,
          },
        },
        reschedule: false,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not re-fetch once the transaction is already marked invalid', () => {
    const { refresher } = setup();

    expect(
      refresher.shouldFetch(
        createTransactionContext({
          transactionsFetchStatus: FetchStatus.Error,
        }),
      ),
    ).toBe(false);
  });

  it('does not re-fetch when the context is missing transaction fields', () => {
    const { refresher } = setup();

    expect(refresher.shouldFetch(createConfirmationDataContext())).toBe(false);
  });

  it('clears a stuck loading state via recovery', () => {
    const { refresher } = setup();

    expect(
      refresher.recoveryResult(
        createTransactionContext({
          transactionsFetchStatus: FetchStatus.Fetching,
        }),
      ),
    ).toStrictEqual({
      result: { transactionsFetchStatus: FetchStatus.Fetched },
      reschedule: false,
    });
  });
});
