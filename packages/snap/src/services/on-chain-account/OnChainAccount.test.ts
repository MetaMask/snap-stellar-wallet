import { Account } from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import type { OnChainAccountSnapshot } from './api';
import { OnChainAccountBalanceNotAvailableException } from './exceptions';
import type { SpendableBalance } from './OnChainAccount';
import { OnChainAccount } from './OnChainAccount';
import { KnownCaip2ChainId } from '../../api';
import {
  getSlip44AssetId,
  toCaip19ClassicAssetId,
  toSmallestUnit,
} from '../../utils';
import type {
  AccountBalance,
  TrustLineAssetBalance,
} from '../account-balance/api';
import {
  createMockAccountWithBalances,
  DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
} from './__mocks__/onChainAccount.fixtures';
import { getTestWallet } from '../wallet/__mocks__/wallet.fixtures';

/**
 * Maps an on-chain trustline view to persisted {@link TrustLineAssetBalance} shape.
 *
 * @param row - Classic trustline row from {@link OnChainAccount.getAsset}.
 * @returns Balance row as stored by account balance sync.
 */
function trustLineToPersistedBalance(
  row: SpendableBalance,
): TrustLineAssetBalance {
  const base: TrustLineAssetBalance = {
    unit: row.symbol,
    amount: row.balance.toString(),
    limit: row.limit?.toString() ?? '0',
  };
  return {
    ...base,
    ...(typeof row.authorized === 'boolean'
      ? { authorized: row.authorized }
      : {}),
    ...(row.sponsored ? { sponsored: true } : {}),
  };
}

describe('OnChainAccount', () => {
  const testWalletSigner = getTestWallet();
  const testOnChain = new OnChainAccount(
    createMockAccountWithBalances(
      testWalletSigner.address,
      '1',
      DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
    ),
    KnownCaip2ChainId.Mainnet,
  );
  const createTestWallet = () => {
    const wallet = getTestWallet();
    return {
      wallet,
      onChainAccount: new OnChainAccount(
        createMockAccountWithBalances(wallet.address, '1', {
          nativeBalance: 10,
          subentryCount: 0,
          sponsoringCount: 0,
          sponsoredCount: 0,
          assets: [
            {
              assetType: 'credit_alphanum4',
              assetCode: 'USDC',
              assetIssuer:
                'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
              balance: 10,
            },
          ],
        }),
        KnownCaip2ChainId.Mainnet,
      ),
    };
  };

  const createAccReserve = 2;
  const createSubentryReserve = 1;

  describe('accountId', () => {
    it('returns the account id', () => {
      expect(testWalletSigner.address).toBe(testOnChain.accountId);
    });
  });

  describe('sequenceNumber', () => {
    it('returns the sequence number', () => {
      expect(testOnChain.sequenceNumber).toBeDefined();
    });
  });

  describe('hasAsset', () => {
    it('returns true if the account has the trustline', () => {
      const { onChainAccount } = createTestWallet();
      expect(
        onChainAccount.hasAsset(
          toCaip19ClassicAssetId(
            KnownCaip2ChainId.Mainnet,
            'USDC',
            'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          ),
        ),
      ).toBe(true);
    });

    it('returns false if the account does not have the trustline', () => {
      const { onChainAccount } = createTestWallet();
      expect(
        onChainAccount.hasAsset(
          toCaip19ClassicAssetId(
            KnownCaip2ChainId.Mainnet,
            'AAAA',
            'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          ),
        ),
      ).toBe(false);
    });

    it('returns false when account has no Horizon balance metadata', () => {
      const onChainAccount = new OnChainAccount(
        new Account(testOnChain.accountId, testOnChain.sequenceNumber),
        KnownCaip2ChainId.Mainnet,
      );
      expect(
        onChainAccount.hasAsset(
          toCaip19ClassicAssetId(
            KnownCaip2ChainId.Mainnet,
            'AAAA',
            'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          ),
        ),
      ).toBe(false);
    });
  });

  describe('getScope', () => {
    it('returns the scope', () => {
      const { onChainAccount } = createTestWallet();
      expect(onChainAccount.scope).toStrictEqual(KnownCaip2ChainId.Mainnet);
    });
  });

  describe('getAsset', () => {
    it.each([
      {
        assetId: toCaip19ClassicAssetId(
          KnownCaip2ChainId.Mainnet,
          'USDC',
          'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        ),
        expected: {
          balance: new BigNumber('100000000'),
          symbol: 'USDC',
          address: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          limit: new BigNumber('9223372036854775807'),
          authorized: true,
        },
      },
      {
        assetId: getSlip44AssetId(KnownCaip2ChainId.Mainnet),
        expected: {
          address: undefined,
          balance: new BigNumber('90000000'),
          symbol: 'XLM',
        },
      },
    ])(
      'returns the balance for the asset - $assetId',
      ({ assetId, expected }) => {
        const { onChainAccount } = createTestWallet();
        expect(onChainAccount.getAsset(assetId)).toStrictEqual(expected);
      },
    );

    it('throws OnChainAccountBalanceNotAvailableException when account has no loaded balances', () => {
      const onChainAccount = new OnChainAccount(
        new Account(testOnChain.accountId, testOnChain.sequenceNumber),
        KnownCaip2ChainId.Mainnet,
      );
      expect(() =>
        onChainAccount.getAsset(
          toCaip19ClassicAssetId(
            KnownCaip2ChainId.Mainnet,
            'AAAA',
            'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          ),
        ),
      ).toThrow(OnChainAccountBalanceNotAvailableException);
    });
  });

  describe('getNativeSpendableBalance', () => {
    it.each([
      // Test case with no trustlines
      {
        subentryCount: 0,
        sponsoringCount: 0,
        sponsoredCount: 0,
        nativeBalance: 3,
        expected: toSmallestUnit(new BigNumber('2')),
      },
      // Test case with 2 trustlines
      {
        subentryCount: createSubentryReserve * 2,
        sponsoringCount: 0,
        sponsoredCount: 0,
        nativeBalance: 3,
        expected: toSmallestUnit(new BigNumber('1')),
      },
      // Test case with 2 trustlines and 1 of those is sponsored
      {
        subentryCount: createSubentryReserve * 2,
        sponsoringCount: 0,
        sponsoredCount: createSubentryReserve,
        nativeBalance: 3,
        expected: toSmallestUnit(new BigNumber('1.5')),
      },
      // Test case with 1 trustlines and the user is sponsored by another account
      {
        subentryCount: createSubentryReserve,
        sponsoringCount: 0,
        sponsoredCount: createAccReserve,
        nativeBalance: 1,
        expected: toSmallestUnit(new BigNumber('0.5')),
      },
      // Test case with 2 trustlines, 2 of those is sponsored, and the user is sponsored by another account
      {
        subentryCount: createSubentryReserve * 2,
        sponsoringCount: 0,
        sponsoredCount: createAccReserve + createSubentryReserve * 2,
        nativeBalance: 0,
        expected: toSmallestUnit(new BigNumber('0')),
      },
      // Test case with 2 trustlines, 2 of those is sponsored, and the user is sponsored by another account, and it sponering another account create
      {
        subentryCount: createSubentryReserve * 2,
        sponsoringCount: createAccReserve,
        sponsoredCount: createSubentryReserve * 2 + createAccReserve,
        nativeBalance: 1,
        expected: toSmallestUnit(new BigNumber('0')),
      },
    ])(
      'returns the native spendable balance for the account - subentryCount: $subentryCount, sponsoringCount: $sponsoringCount, sponsoredCount: $sponsoredCount, nativeBalance: $nativeBalance',
      ({
        subentryCount,
        sponsoringCount,
        sponsoredCount,
        nativeBalance,
        expected,
      }) => {
        const wallet = getTestWallet();
        const onChainAccount = new OnChainAccount(
          createMockAccountWithBalances(wallet.address, '1', {
            nativeBalance,
            subentryCount,
            sponsoringCount,
            sponsoredCount,
            assets: [],
          }),
          KnownCaip2ChainId.Mainnet,
        );

        expect(onChainAccount.nativeSpendableBalance).toStrictEqual(expected);
      },
    );

    it('throws an error if the balance metadata is not available', () => {
      const onChainAccount = new OnChainAccount(
        new Account(testOnChain.accountId, testOnChain.sequenceNumber),
        KnownCaip2ChainId.Mainnet,
      );
      expect(() => onChainAccount.nativeSpendableBalance).toThrow(Error);
    });
  });

  describe('getRaw', () => {
    it('returns the raw account', () => {
      const account = new Account(
        'GB5QOHJZ6RACA26NFDIEHD7I7SLROLC5P4NATSG43OJV2C5WUR4VEUKG',
        '1',
      );
      const onChainAccount = new OnChainAccount(
        account,
        KnownCaip2ChainId.Mainnet,
      );
      expect(onChainAccount.getRaw()).toBe(account);
    });
  });

  describe('fromSnapshot', () => {
    it('matches Horizon-bound balances for native and classic trustline', () => {
      const { onChainAccount: ref } = createTestWallet();
      const usdcId = toCaip19ClassicAssetId(
        KnownCaip2ChainId.Mainnet,
        'USDC',
        'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      );
      const nativeId = getSlip44AssetId(KnownCaip2ChainId.Mainnet);
      const classicRow = ref.getAsset(usdcId);
      const balances: AccountBalance = {
        [nativeId]: {
          unit: 'XLM',
          amount: ref.nativeRawBalance.toString(),
        },
        [usdcId]: trustLineToPersistedBalance(classicRow),
      };
      const snapshot: OnChainAccountSnapshot = {
        accountId: ref.accountId,
        sequenceNumber: ref.sequenceNumber,
        subentryCount: ref.subentryCount,
        numSponsoring: ref.numSponsoring,
        numSponsored: ref.numSponsored,
      };
      const restored = OnChainAccount.fromSnapshot({
        snapshot,
        balances,
        scope: KnownCaip2ChainId.Mainnet,
      });
      expect(restored.nativeSpendableBalance).toStrictEqual(
        ref.nativeSpendableBalance,
      );
      expect(restored.nativeRawBalance).toStrictEqual(ref.nativeRawBalance);
      expect(restored.getAsset(usdcId)).toStrictEqual(classicRow);
      expect(restored.getAsset(nativeId)).toStrictEqual(ref.getAsset(nativeId));
    });
  });
});
