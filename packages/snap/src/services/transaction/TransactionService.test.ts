import { TransactionStatus, TransactionType } from '@metamask/keyring-api';

import { KnownCaip2ChainId } from '../../api';
import { getSlip44AssetId } from '../../utils';
import { createMockTransactionService } from './__mocks__/transaction.fixtures';
import { generateMockStellarKeyringAccounts } from '../account/__mocks__/account.fixtures';
import type { StellarKeyringAccount } from '../account/api';

jest.mock('../../utils/logger');
jest.mock('../../utils/snap');

describe('TransactionService', () => {
  describe('createPendingSendTransaction', () => {
    it('creates a pending send transaction', async () => {
      const { transactionService, transactionRepositorySaveSpy } =
        createMockTransactionService();
      const [fromAccount, toAccount] = generateMockStellarKeyringAccounts(
        2,
        'test-entropy',
      ) as [StellarKeyringAccount, StellarKeyringAccount];

      const transaction = await transactionService.createPendingSendTransaction(
        {
          txId: 'test-tx-id',
          account: fromAccount,
          scope: KnownCaip2ChainId.Mainnet,
          toAddress: toAccount.address,
          amount: '10000000',
          asset: {
            type: getSlip44AssetId(KnownCaip2ChainId.Mainnet),
            symbol: 'XLM',
          },
        },
      );

      const expectedTransaction = {
        type: TransactionType.Send,
        id: 'test-tx-id',
        from: [
          {
            address: fromAccount.address,
            asset: {
              type: getSlip44AssetId(KnownCaip2ChainId.Mainnet),
              unit: 'XLM',
              amount: '10000000',
              fungible: true,
            },
          },
        ],
        to: [
          {
            address: toAccount.address,
            asset: {
              type: getSlip44AssetId(KnownCaip2ChainId.Mainnet),
              unit: 'XLM',
              amount: '10000000',
              fungible: true,
            },
          },
        ],
        events: [
          {
            status: TransactionStatus.Unconfirmed,
            timestamp: expect.any(Number),
          },
        ],
        chain: KnownCaip2ChainId.Mainnet,
        status: TransactionStatus.Unconfirmed,
        account: fromAccount.id,
        timestamp: expect.any(Number),
        fees: [],
      };

      expect(transaction).toStrictEqual(expectedTransaction);
      expect(transactionRepositorySaveSpy).toHaveBeenCalledWith(
        expectedTransaction,
      );
    });
  });
});
