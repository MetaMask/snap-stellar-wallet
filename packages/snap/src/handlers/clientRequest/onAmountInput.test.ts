import { InvalidParamsError } from '@metamask/snaps-sdk';
import { BigNumber } from 'bignumber.js';

import {
  ClientRequestMethod,
  MultiChainSendErrorCodes,
  type OnAmountInputJsonRpcRequest,
} from './api';
import { OnAmountInputHandler } from './onAmountInput';
import { KnownCaip2ChainId, type KnownCaip19ClassicAssetId } from '../../api';
import { AccountService } from '../../services/account';
import { generateStellarKeyringAccount } from '../../services/account/__mocks__/account.fixtures';
import type { StellarAssetMetadata } from '../../services/asset-metadata';
import { AssetMetadataService } from '../../services/asset-metadata';
import {
  createMockAssetMetadataService,
  generateMockStellarAssetMetadata,
  USDC_CLASSIC,
} from '../../services/asset-metadata/__mocks__/assets.fixtures';
import { AccountNotActivatedException } from '../../services/network';
import {
  OnChainAccount,
  OnChainAccountService,
} from '../../services/on-chain-account';
import {
  createMockAccountWithBalances,
  DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
  horizonSource,
  mockOnChainAccountService,
} from '../../services/on-chain-account/__mocks__/onChainAccount.fixtures';
import type { Transaction } from '../../services/transaction';
import { TransactionService } from '../../services/transaction';
import { createMockTransactionService } from '../../services/transaction/__mocks__/transaction.fixtures';
import {
  InsufficientBalanceException,
  InsufficientBalanceToCoverFeeException,
  TransactionValidationException,
} from '../../services/transaction/exceptions';
import { WalletService } from '../../services/wallet';
import { getTestWallet } from '../../services/wallet/__mocks__/wallet.fixtures';
import { logger } from '../../utils/logger';
import { AccountResolver } from '../accountResolver';

jest.mock('../../utils/logger');
jest.mock('../../utils/snap');
jest.mock('../../ui/confirmation/views/AccountActivationPrompt/render', () => ({
  render: jest.fn().mockResolvedValue(undefined),
}));

const destinationAddress =
  'GDTF7ERUQVTX23ZD6NY5XRYC5IQAKWFVTQ6IXSMEZWGVNDDGPYCVHRZP';

describe('OnAmountInputHandler', () => {
  const accountId = '11111111-1111-4111-8111-111111111111';
  const assetId = USDC_CLASSIC as KnownCaip19ClassicAssetId;
  const scope = KnownCaip2ChainId.Mainnet;

  function setup() {
    const wallet = getTestWallet();
    const account = generateStellarKeyringAccount(
      accountId,
      wallet.address,
      'entropy-source-1',
      0,
    );
    const mockRawAccount = createMockAccountWithBalances(wallet.address, '1', {
      ...DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
      nativeBalance: 10,
      assets: [],
    });
    const onChainAccount = new OnChainAccount(
      mockRawAccount,
      scope,
      horizonSource(mockRawAccount, scope),
    );

    const { accountService, onChainAccountService, walletService } =
      mockOnChainAccountService();
    jest.spyOn(AccountService.prototype, 'resolveAccount').mockResolvedValue({
      account,
    });
    const resolveOnChainAccountByKeyringAccountIdSpy = jest
      .spyOn(
        OnChainAccountService.prototype,
        'resolveOnChainAccountByKeyringAccountId',
      )
      .mockResolvedValue(onChainAccount);
    jest
      .spyOn(WalletService.prototype, 'resolveWallet')
      .mockResolvedValue(wallet);

    const { transactionService } = createMockTransactionService();
    const createValidatedSendTransaction = jest
      .spyOn(TransactionService.prototype, 'createValidatedSendTransaction')
      .mockResolvedValue({} as Transaction);

    const { service: assetMetadataService } = createMockAssetMetadataService();
    const assetMetadata = generateMockStellarAssetMetadata()[
      assetId
    ] as StellarAssetMetadata;
    jest
      .spyOn(AssetMetadataService.prototype, 'resolve')
      .mockResolvedValue(assetMetadata);

    const accountResolver = new AccountResolver({
      accountService,
      onChainAccountService,
      walletService,
    });

    const handler = new OnAmountInputHandler({
      logger,
      accountResolver,
      assetMetadataService,
      transactionService,
    });

    return {
      handler,
      account,
      onChainAccount,
      wallet,
      createValidatedSendTransaction,
      resolveOnChainAccountByKeyringAccountIdSpy,
    };
  }

  function baseRequest(
    overrides: Partial<OnAmountInputJsonRpcRequest['params']> = {},
  ): OnAmountInputJsonRpcRequest {
    return {
      jsonrpc: '2.0',
      id: 1,
      method: ClientRequestMethod.OnAmountInput,
      params: {
        accountId,
        assetId,
        value: '1',
        ...overrides,
      },
    };
  }

  it('returns valid when send validation succeeds', async () => {
    const { handler, onChainAccount, createValidatedSendTransaction } = setup();

    const result = await handler.handle(baseRequest());

    expect(result).toStrictEqual({ valid: true, errors: [] });
    expect(createValidatedSendTransaction).toHaveBeenCalledWith({
      onChainAccount,
      scope,
      assetId,
      amount: new BigNumber('10000000'),
      destination: onChainAccount.accountId,
      useCache: true,
    });
  });

  it('passes explicit destination when params.to is set', async () => {
    const { handler, onChainAccount, createValidatedSendTransaction } = setup();

    await handler.handle(baseRequest({ to: destinationAddress }));

    expect(createValidatedSendTransaction).toHaveBeenCalledWith({
      onChainAccount,
      scope,
      assetId,
      amount: new BigNumber('10000000'),
      destination: destinationAddress,
      useCache: true,
    });
  });

  it('returns insufficient balance when createValidatedSendTransaction throws InsufficientBalanceException', async () => {
    const { handler, createValidatedSendTransaction } = setup();
    createValidatedSendTransaction.mockRejectedValueOnce(
      new InsufficientBalanceException('0', '1'),
    );

    expect(await handler.handle(baseRequest())).toStrictEqual({
      valid: false,
      errors: [{ code: MultiChainSendErrorCodes.InsufficientBalance }],
    });
  });

  it('returns insufficient balance to cover fee when createValidatedSendTransaction throws InsufficientBalanceToCoverFeeException', async () => {
    const { handler, createValidatedSendTransaction } = setup();
    createValidatedSendTransaction.mockRejectedValueOnce(
      new InsufficientBalanceToCoverFeeException('0', '1'),
    );

    expect(await handler.handle(baseRequest())).toStrictEqual({
      valid: false,
      errors: [
        { code: MultiChainSendErrorCodes.InsufficientBalanceToCoverFee },
      ],
    });
  });

  it('returns invalid when createValidatedSendTransaction throws TransactionValidationException', async () => {
    const { handler, createValidatedSendTransaction } = setup();
    createValidatedSendTransaction.mockRejectedValueOnce(
      new TransactionValidationException('x'),
    );

    expect(await handler.handle(baseRequest())).toStrictEqual({
      valid: false,
      errors: [{ code: MultiChainSendErrorCodes.Invalid }],
    });
  });

  it('returns invalid when createValidatedSendTransaction throws AccountNotActivatedException', async () => {
    const { handler, createValidatedSendTransaction, wallet } = setup();
    createValidatedSendTransaction.mockRejectedValueOnce(
      new AccountNotActivatedException(wallet.address, scope),
    );

    expect(await handler.handle(baseRequest())).toStrictEqual({
      valid: false,
      errors: [{ code: MultiChainSendErrorCodes.Invalid }],
    });
  });

  it('rethrows AccountNotActivatedException when keyring state has no on-chain snapshot', async () => {
    const { handler, resolveOnChainAccountByKeyringAccountIdSpy, wallet } =
      setup();
    resolveOnChainAccountByKeyringAccountIdSpy.mockResolvedValueOnce(null);

    await expect(handler.handle(baseRequest())).rejects.toMatchObject({
      address: wallet.address,
      scope,
    });
  });

  it('rethrows unexpected errors from createValidatedSendTransaction', async () => {
    const { handler, createValidatedSendTransaction } = setup();
    createValidatedSendTransaction.mockRejectedValueOnce(
      new Error('unexpected'),
    );

    await expect(handler.handle(baseRequest())).rejects.toThrow('unexpected');
  });

  it('throws InvalidParamsError when the request fails struct validation', async () => {
    const { handler } = setup();
    const badRequest = {
      jsonrpc: '2.0' as const,
      id: 1,
      method: ClientRequestMethod.OnAmountInput,
      params: {
        accountId,
        assetId,
        value: '',
      },
    };

    await expect(handler.handle(badRequest)).rejects.toThrow(
      InvalidParamsError,
    );
  });
});
