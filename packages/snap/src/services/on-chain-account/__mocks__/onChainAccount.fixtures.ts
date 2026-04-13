/* eslint-disable @typescript-eslint/naming-convention */
import { Account } from '@stellar/stellar-sdk';

import { logger } from '../../../utils/logger';
import { AccountService } from '../../account/AccountService';
import { AccountsRepository } from '../../account/AccountsRepository';
import { NetworkService } from '../../network';
import { State } from '../../state/State';
import { WalletService } from '../../wallet';
import { OnChainAccountService } from '../OnChainAccountService';

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
