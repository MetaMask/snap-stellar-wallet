import { Account, Keypair } from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import {
  createMockAccountWithBalances,
  DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
  horizonSource,
  unfundedHorizonBinding,
} from './__mocks__/onChainAccount.fixtures';
import {
  OnChainAccountBalanceNotAvailableException,
  OnChainAccountException,
} from './exceptions';
import { OnChainAccount } from './OnChainAccount';
import type {
  OnChainAccountSerializable,
  OnChainAccountSerializableFull,
} from './OnChainAccountSerializable';
import { OnChainAccountSerializableFullStruct } from './OnChainAccountSerializable';
import { calculateSpendableBalance, minimumBalanceStroops } from './utils';
import { KnownCaip2ChainId } from '../../api';
import {
  getSlip44AssetId,
  toCaip19ClassicAssetId,
  toSmallestUnit,
} from '../../utils';
import { getTestWallet } from '../wallet/__mocks__/wallet.fixtures';

function expectDefined<ValueType>(value: ValueType | undefined): ValueType {
  expect(value).toBeDefined();
  return value as ValueType;
}

function optionalBigNumberString(
  value: BigNumber | undefined,
): string | undefined {
  return value === undefined ? undefined : value.toString();
}

describe('OnChainAccount', () => {
  const testWalletSigner = getTestWallet();
  const testMockAccount = createMockAccountWithBalances(
    testWalletSigner.address,
    '1',
    DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
  );
  const testOnChain = new OnChainAccount(
    testMockAccount,
    KnownCaip2ChainId.Mainnet,
    horizonSource(testMockAccount, KnownCaip2ChainId.Mainnet),
  );
  const createTestWallet = () => {
    const wallet = getTestWallet();
    return {
      wallet,
      onChainAccount: (() => {
        const acc = createMockAccountWithBalances(wallet.address, '1', {
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
        });
        return new OnChainAccount(
          acc,
          KnownCaip2ChainId.Mainnet,
          horizonSource(acc, KnownCaip2ChainId.Mainnet),
        );
      })(),
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
      const acc = new Account(
        testOnChain.accountId,
        testOnChain.sequenceNumber,
      );
      const onChainAccount = new OnChainAccount(
        acc,
        KnownCaip2ChainId.Mainnet,
        unfundedHorizonBinding(acc, KnownCaip2ChainId.Mainnet),
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

    it('returns undefined when the account has no balance row for the asset id', () => {
      const acc = new Account(
        testOnChain.accountId,
        testOnChain.sequenceNumber,
      );
      const onChainAccount = new OnChainAccount(
        acc,
        KnownCaip2ChainId.Mainnet,
        unfundedHorizonBinding(acc, KnownCaip2ChainId.Mainnet),
      );
      expect(
        onChainAccount.getAsset(
          toCaip19ClassicAssetId(
            KnownCaip2ChainId.Mainnet,
            'AAAA',
            'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          ),
        ),
      ).toBeUndefined();
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
        const acc = createMockAccountWithBalances(wallet.address, '1', {
          nativeBalance,
          subentryCount,
          sponsoringCount,
          sponsoredCount,
          assets: [],
        });
        const onChainAccount = new OnChainAccount(
          acc,
          KnownCaip2ChainId.Mainnet,
          horizonSource(acc, KnownCaip2ChainId.Mainnet),
        );

        expect(onChainAccount.nativeSpendableBalance).toStrictEqual(expected);
      },
    );

    it('throws when native balance is not bound', () => {
      const acc = new Account(
        testOnChain.accountId,
        testOnChain.sequenceNumber,
      );
      const onChainAccount = new OnChainAccount(
        acc,
        KnownCaip2ChainId.Mainnet,
        unfundedHorizonBinding(acc, KnownCaip2ChainId.Mainnet),
      );
      expect(() => onChainAccount.nativeSpendableBalance).toThrow(
        OnChainAccountBalanceNotAvailableException,
      );
    });
  });

  describe('getRaw', () => {
    it('returns the raw account', () => {
      const account = createMockAccountWithBalances(
        'GB5QOHJZ6RACA26NFDIEHD7I7SLROLC5P4NATSG43OJV2C5WUR4VEUKG',
        '1',
        { nativeBalance: 1, subentryCount: 0, assets: [] },
      );
      const onChainAccount = new OnChainAccount(
        account,
        KnownCaip2ChainId.Mainnet,
        horizonSource(account, KnownCaip2ChainId.Mainnet),
      );
      expect(onChainAccount.getRaw()).toBe(account);
    });
  });

  describe('toSerializable', () => {
    it('returns minimal serializable when not fully hydrated', () => {
      const acc = new Account(
        testOnChain.accountId,
        testOnChain.sequenceNumber,
      );
      const onChainAccount = new OnChainAccount(
        acc,
        KnownCaip2ChainId.Mainnet,
        unfundedHorizonBinding(acc, KnownCaip2ChainId.Mainnet),
      );
      expect(onChainAccount.toSerializable()).toStrictEqual(
        onChainAccount.toMinimalSerializable(),
      );
    });

    it('returns full payload with string numerics in balances and rawNativeBalance', () => {
      const { onChainAccount } = createTestWallet();
      const ser = onChainAccount.toSerializable();
      expect(OnChainAccountSerializableFullStruct.is(ser)).toBe(true);
      const fullSer = ser as OnChainAccountSerializableFull;
      expect(ser.accountId).toBe(onChainAccount.accountId);
      expect(ser.sequenceNumber).toBe(onChainAccount.sequenceNumber);
      expect(ser.scope).toBe(KnownCaip2ChainId.Mainnet);
      expect(fullSer.meta).toStrictEqual({
        subentryCount: onChainAccount.subentryCount,
        numSponsoring: onChainAccount.numSponsoring,
        numSponsored: onChainAccount.numSponsored,
      });
      const nativeId = getSlip44AssetId(KnownCaip2ChainId.Mainnet);
      const usdcId = toCaip19ClassicAssetId(
        KnownCaip2ChainId.Mainnet,
        'USDC',
        'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      );
      const nativeRow = expectDefined(onChainAccount.getAsset(nativeId));
      const usdcRow = expectDefined(onChainAccount.getAsset(usdcId));
      expect(fullSer.balances[nativeId]).toStrictEqual({
        balance: nativeRow.balance.toString(),
        symbol: nativeRow.symbol,
        limit: optionalBigNumberString(nativeRow.limit),
        address: nativeRow.address,
        authorized: nativeRow.authorized,
        sponsored: nativeRow.sponsored,
      });
      expect(fullSer.balances[usdcId]).toStrictEqual({
        balance: usdcRow.balance.toString(),
        symbol: usdcRow.symbol,
        address: usdcRow.address,
        limit: optionalBigNumberString(usdcRow.limit),
        authorized: usdcRow.authorized,
        sponsored: usdcRow.sponsored,
      });
      expect(fullSer.rawNativeBalance).toBe(
        onChainAccount.nativeRawBalance.toFixed(0),
      );
    });

    it('serializes zero classic trustline limit as string zero in snapshot', () => {
      const scope = KnownCaip2ChainId.Mainnet;
      const nativeId = getSlip44AssetId(scope);
      const usdcId = toCaip19ClassicAssetId(
        scope,
        'USDC',
        'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      );
      const accountId = Keypair.random().publicKey();
      const data: OnChainAccountSerializableFull = {
        accountId,
        sequenceNumber: '1',
        scope,
        meta: { subentryCount: 0, numSponsoring: 0, numSponsored: 0 },
        rawNativeBalance: '200000000',
        balances: {
          [nativeId]: { balance: '0', symbol: 'XLM' },
          [usdcId]: {
            balance: '1000000',
            symbol: 'USDC',
            address: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
            limit: '0',
            authorized: true,
          },
        } as OnChainAccountSerializableFull['balances'],
      };
      const acc = new Account(accountId, '1');
      const onChainAccount = new OnChainAccount(acc, scope, data);
      const ser = onChainAccount.toSerializable();
      expect(OnChainAccountSerializableFullStruct.is(ser)).toBe(true);
      expect(
        (ser as OnChainAccountSerializableFull).balances[usdcId]?.limit,
      ).toBe('0');
    });
  });

  describe('fromSerializable', () => {
    it('round-trips with toSerializable for Horizon-bound wallet', () => {
      const { onChainAccount: ref } = createTestWallet();
      const restored = OnChainAccount.fromSerializable(ref.toSerializable());
      expect(restored.accountId).toBe(ref.accountId);
      expect(restored.sequenceNumber).toBe(ref.sequenceNumber);
      expect(restored.scope).toBe(ref.scope);
      expect(restored.subentryCount).toBe(ref.subentryCount);
      expect(restored.nativeRawBalance).toStrictEqual(ref.nativeRawBalance);
      expect(restored.nativeSpendableBalance).toStrictEqual(
        ref.nativeSpendableBalance,
      );
      const usdcId = toCaip19ClassicAssetId(
        KnownCaip2ChainId.Mainnet,
        'USDC',
        'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      );
      expect(restored.getAsset(usdcId)).toStrictEqual(ref.getAsset(usdcId));
      expect(
        restored.getAsset(getSlip44AssetId(KnownCaip2ChainId.Mainnet)),
      ).toStrictEqual(
        ref.getAsset(getSlip44AssetId(KnownCaip2ChainId.Mainnet)),
      );
    });

    it('throws when binding is partial (meta and balances but no rawNativeBalance)', () => {
      const { onChainAccount } = createTestWallet();
      const ser = onChainAccount.toSerializable();
      expect(OnChainAccountSerializableFullStruct.is(ser)).toBe(true);
      const fullSer = ser as OnChainAccountSerializableFull;
      const { rawNativeBalance: _omitRaw, ...rest } = fullSer;
      expect(() =>
        OnChainAccount.fromSerializable(rest as OnChainAccountSerializable),
      ).toThrow(OnChainAccountException);
    });

    it('round-trips minimal binding via toMinimalSerializable', () => {
      const acc = new Account(
        testOnChain.accountId,
        testOnChain.sequenceNumber,
      );
      const binding = unfundedHorizonBinding(acc, KnownCaip2ChainId.Mainnet);
      const restored = OnChainAccount.fromSerializable(binding);
      expect(restored.toMinimalSerializable()).toStrictEqual(binding);
    });

    it('uses rawNativeBalance for raw native when spendable is clamped to zero', () => {
      const scope = KnownCaip2ChainId.Mainnet;
      const nativeId = getSlip44AssetId(scope);
      const accountId = Keypair.random().publicKey();
      const meta = {
        subentryCount: 100,
        numSponsoring: 0,
        numSponsored: 0,
      };
      const totalNative = new BigNumber('1000');
      const minReserve = minimumBalanceStroops(meta);
      expect(totalNative.lt(minReserve)).toBe(true);
      const spendable = calculateSpendableBalance({
        nativeBalance: totalNative,
        ...meta,
      });
      expect(spendable.isZero()).toBe(true);

      const data: OnChainAccountSerializableFull = {
        accountId,
        sequenceNumber: '1',
        scope,
        meta,
        balances: {
          [nativeId]: { balance: spendable.toString(), symbol: 'XLM' },
        } as OnChainAccountSerializableFull['balances'],
        rawNativeBalance: totalNative.toFixed(0),
      };
      const acc = new Account(accountId, '1');
      const onChain = new OnChainAccount(acc, scope, data);
      expect(onChain.nativeRawBalance).toStrictEqual(totalNative);
      expect(onChain.nativeSpendableBalance).toStrictEqual(spendable);
    });
  });
});
