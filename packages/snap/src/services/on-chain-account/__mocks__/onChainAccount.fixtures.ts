/* eslint-disable @typescript-eslint/naming-convention */
import type { Horizon } from '@stellar/stellar-sdk';
import { Account } from '@stellar/stellar-sdk';

import type { KnownCaip2ChainId } from '../../../api';
import { logger } from '../../../utils/logger';
import { AccountService } from '../../account/AccountService';
import { AccountsRepository } from '../../account/AccountsRepository';
import { NetworkService } from '../../network';
import { State } from '../../state/State';
import { WalletService } from '../../wallet';
import { OnChainAccount } from '../OnChainAccount';
import type { OnChainAccountSerializable } from '../OnChainAccountSerializable';
import { OnChainAccountService } from '../OnChainAccountService';

/**
 * Wraps a Horizon-shaped SDK account as {@link OnChainAccountSerializable} for tests.
 *
 * @param account - Mock or SDK account that includes Horizon `balances` / meta fields.
 * @param scope - CAIP-2 network (must match the `OnChainAccount` constructor scope).
 * @returns Serializable binding for {@link OnChainAccount} constructor.
 */
export function horizonSource(
  account: Account,
  scope: KnownCaip2ChainId,
): OnChainAccountSerializable {
  return OnChainAccount.fromHorizon(
    account as unknown as Horizon.AccountResponse,
    scope,
  ).toSerializable();
}

/**
 * Serializable binding with no balance lines (sequence exists, no asset rows yet).
 *
 * @param account - Bare SDK `Account` instance (mutated to add empty `balances`).
 * @param scope - CAIP-2 network.
 * @returns Binding for {@link OnChainAccount} constructor.
 */
export function unfundedHorizonBinding(
  account: Account,
  scope: KnownCaip2ChainId,
): OnChainAccountSerializable {
  const response = Object.assign(account, {
    balances: [],
    subentry_count: 0,
    num_sponsoring: 0,
    num_sponsored: 0,
  }) as unknown as Horizon.AccountResponse;
  return OnChainAccount.fromHorizon(response, scope).toSerializable();
}

export type MockAssetLine = {
  assetType: string;
  assetCode: string;
  assetIssuer: string;
  balance: number;
  /** Horizon `is_authorized`; defaults to true when omitted. */
  isAuthorized?: boolean;
};

export type MockAccountWithBalancesData = {
  nativeBalance: number;
  assets: MockAssetLine[];
  sponsoringCount?: number;
  sponsoredCount?: number;
  subentryCount?: number;
};

/** Default Horizon-shaped balance payload for tests that only need a funded mock account. */
export const DEFAULT_MOCK_ACCOUNT_WITH_BALANCES: MockAccountWithBalancesData = {
  nativeBalance: 1,
  assets: [],
  sponsoringCount: 0,
  sponsoredCount: 0,
  subentryCount: 0,
};

export const createMockAccountWithBalances = (
  accountId: string,
  accountSequence: string,
  {
    subentryCount = 0,
    sponsoringCount = 0,
    sponsoredCount = 0,
    nativeBalance = 1,
    assets = [],
  }: MockAccountWithBalancesData,
) => {
  class MockAccount extends Account {
    subentry_count: number;

    num_sponsoring: number;

    num_sponsored: number;

    balances: unknown[];

    constructor(
      id: string,
      sequence: string,
      inputSubentryCount: number,
      inputSponsoringCount: number,
      inputSponsoredCount: number,
      inputNativeBalance: number,
      inputAssets: MockAssetLine[],
    ) {
      super(id, sequence);
      this.subentry_count = inputSubentryCount;
      this.num_sponsoring = inputSponsoringCount;
      this.num_sponsored = inputSponsoredCount;
      this.balances = [
        ...inputAssets.map((asset) => ({
          balance: asset.balance.toString(),
          limit: '922337203685.4775807',
          buying_liabilities: '0.0000000',
          selling_liabilities: '0.0000000',
          asset_type: asset.assetType,
          asset_code: asset.assetCode,
          asset_issuer: asset.assetIssuer,
          is_authorized: asset.isAuthorized !== false,
        })),
        {
          balance: inputNativeBalance.toString(),
          buying_liabilities: '0.0000000',
          selling_liabilities: '0.0000000',
          asset_type: 'native',
        },
      ];
    }
  }
  return new MockAccount(
    accountId,
    accountSequence,
    subentryCount,
    sponsoringCount,
    sponsoredCount,
    nativeBalance,
    assets,
  );
};

/**
 * Builds {@link OnChainAccountService} with real {@link AccountService}, shared {@link State},
 * and {@link NetworkService}, for integration-style tests.
 *
 * @returns On-chain service plus the account and wallet services wired to the same state.
 */
export function mockOnChainAccountService() {
  const walletService = new WalletService({ logger });
  const state = new State({
    encrypted: false,
    defaultState: {
      keyringAccounts: {},
      accountMetadata: {},
    },
  });
  const accountService = new AccountService({
    logger,
    accountsRepository: new AccountsRepository(state),
    walletService,
  });
  const networkService = new NetworkService({ logger });
  const onChainAccountService = new OnChainAccountService({
    networkService,
    accountService,
  });

  return {
    onChainAccountService,
    accountService,
    walletService,
  };
}

/* eslint-enable @typescript-eslint/naming-convention */
