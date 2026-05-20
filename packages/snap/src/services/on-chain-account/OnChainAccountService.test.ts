import { hexToBytes } from '@metamask/utils';
import { Keypair } from '@stellar/stellar-sdk';

import { KnownCaip2ChainId } from '../../api';
import {
  createMockAccountWithBalances,
  DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
  horizonSource,
  mockOnChainAccountService,
} from './__mocks__/onChainAccount.fixtures';
import { OnChainAccount } from './OnChainAccount';
import type { OnChainAccountSerializableFull } from './OnChainAccountSerializable';
import { OnChainAccountSynchronizeService } from './OnChainAccountSynchronizeService';
import { bufferToUint8Array } from '../../utils/buffer';
import {
  generateMockStellarKeyringAccounts,
  generateStellarKeyringAccount,
} from '../account/__mocks__/account.fixtures';
import { DerivedAccountAddressMismatchException } from '../account/exceptions';
import { NetworkService } from '../network';
import { getTestWallet } from '../wallet/__mocks__/wallet.fixtures';

jest.mock('../../utils/logger');
jest.mock('../../utils/snap');

describe('OnChainAccountService', () => {
  const seed = hexToBytes(
    '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  );

  const getNetworkServiceSpies = () => ({
    getAccountOrNullSpy: jest.spyOn(
      NetworkService.prototype,
      'getAccountOrNull',
    ),
    loadOnChainAccountSpy: jest.spyOn(
      NetworkService.prototype,
      'loadOnChainAccount',
    ),
    loadActivatedAccountOrNullSpy: jest.spyOn(
      NetworkService.prototype,
      'loadActivatedAccountOrNull',
    ),
  });

  describe('isAccountActivated', () => {
    it('returns true when getAccountOrNull returns an account', async () => {
      const { getAccountOrNullSpy } = getNetworkServiceSpies();
      const wallet = getTestWallet({ seed });
      const onChainAcc = createMockAccountWithBalances(
        wallet.address,
        '1',
        DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
      );
      const onChain = new OnChainAccount(
        onChainAcc,
        KnownCaip2ChainId.Mainnet,
        horizonSource(onChainAcc, KnownCaip2ChainId.Mainnet),
      );
      getAccountOrNullSpy.mockResolvedValue(onChain);

      const { onChainAccountService } = mockOnChainAccountService();
      const result = await onChainAccountService.isAccountActivated({
        accountAddress: onChain.accountId,
        scope: KnownCaip2ChainId.Mainnet,
      });

      expect(result).toBe(true);
    });

    it('returns false when getAccountOrNull returns null', async () => {
      const { getAccountOrNullSpy } = getNetworkServiceSpies();
      getAccountOrNullSpy.mockResolvedValue(null);

      const { onChainAccountService } = mockOnChainAccountService();
      const result = await onChainAccountService.isAccountActivated({
        accountAddress: Keypair.random().publicKey(),
        scope: KnownCaip2ChainId.Mainnet,
      });

      expect(result).toBe(false);
    });
  });

  describe('resolveOnChainAccount', () => {
    it('returns loaded account when Horizon account id matches the requested address', async () => {
      const signer = Keypair.fromRawEd25519Seed(bufferToUint8Array(seed));
      const keyringAccount = generateStellarKeyringAccount(
        globalThis.crypto.randomUUID(),
        signer.publicKey(),
        'entropy-source-1',
        0,
      );
      const loadedAcc = createMockAccountWithBalances(
        signer.publicKey(),
        '1',
        DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
      );
      const loaded = new OnChainAccount(
        loadedAcc,
        KnownCaip2ChainId.Mainnet,
        horizonSource(loadedAcc, KnownCaip2ChainId.Mainnet),
      );
      const { loadOnChainAccountSpy } = getNetworkServiceSpies();
      loadOnChainAccountSpy.mockResolvedValue(loaded);

      const { onChainAccountService } = mockOnChainAccountService();
      const result = await onChainAccountService.resolveOnChainAccount(
        keyringAccount.address,
        KnownCaip2ChainId.Mainnet,
      );

      expect(result.accountId).toStrictEqual(signer.publicKey());
      expect(loadOnChainAccountSpy).toHaveBeenCalledWith(
        keyringAccount.address,
        KnownCaip2ChainId.Mainnet,
      );
    });

    it('throws when loaded account id does not match the requested address', async () => {
      const signer = Keypair.fromRawEd25519Seed(bufferToUint8Array(seed));
      const other = Keypair.random();
      const loadedAcc = createMockAccountWithBalances(
        other.publicKey(),
        '1',
        DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
      );
      const loaded = new OnChainAccount(
        loadedAcc,
        KnownCaip2ChainId.Mainnet,
        horizonSource(loadedAcc, KnownCaip2ChainId.Mainnet),
      );
      const { loadOnChainAccountSpy } = getNetworkServiceSpies();
      loadOnChainAccountSpy.mockResolvedValue(loaded);

      const { onChainAccountService } = mockOnChainAccountService();
      await expect(
        onChainAccountService.resolveOnChainAccount(
          signer.publicKey(),
          KnownCaip2ChainId.Mainnet,
        ),
      ).rejects.toThrow(DerivedAccountAddressMismatchException);
    });
  });

  describe('resolveOnChainAccountByKeyringAccountId', () => {
    it('returns null when no snapshot exists for the keyring id and scope', async () => {
      const keyringAccountId = globalThis.crypto.randomUUID();
      const { onChainAccountService, onChainAccountRepository } =
        mockOnChainAccountService();
      const findByAccountIdSpy = jest.spyOn(
        onChainAccountRepository,
        'findByKeyringAccountId',
      );
      findByAccountIdSpy.mockResolvedValue(null);

      const result =
        await onChainAccountService.resolveOnChainAccountByKeyringAccountId(
          keyringAccountId,
          KnownCaip2ChainId.Mainnet,
        );

      expect(result).toBeNull();
      expect(findByAccountIdSpy).toHaveBeenCalledWith(
        keyringAccountId,
        KnownCaip2ChainId.Mainnet,
      );
    });

    it('returns rehydrated OnChainAccount when a snapshot exists', async () => {
      const signer = Keypair.fromRawEd25519Seed(bufferToUint8Array(seed));
      const keyringAccountId = globalThis.crypto.randomUUID();
      const loadedAcc = createMockAccountWithBalances(
        signer.publicKey(),
        '1',
        DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
      );
      const binding = horizonSource(
        loadedAcc,
        KnownCaip2ChainId.Mainnet,
      ) as OnChainAccountSerializableFull;

      const { onChainAccountService, onChainAccountRepository } =
        mockOnChainAccountService();
      const findByAccountIdSpy = jest.spyOn(
        onChainAccountRepository,
        'findByKeyringAccountId',
      );
      findByAccountIdSpy.mockResolvedValue(binding);

      const result =
        await onChainAccountService.resolveOnChainAccountByKeyringAccountId(
          keyringAccountId,
          KnownCaip2ChainId.Mainnet,
        );

      expect(result).toBeInstanceOf(OnChainAccount);
      expect(result?.accountId).toStrictEqual(signer.publicKey());
      expect(findByAccountIdSpy).toHaveBeenCalledWith(
        keyringAccountId,
        KnownCaip2ChainId.Mainnet,
      );
    });
  });

  describe('synchronize', () => {
    it('calls OnChainAccountSynchronizeService', async () => {
      const keyringAccounts = generateMockStellarKeyringAccounts(
        2,
        'entropy-source-1',
      );
      const { onChainAccountService } = mockOnChainAccountService();
      const synchronizeSpy = jest.spyOn(
        OnChainAccountSynchronizeService.prototype,
        'synchronize',
      );

      await onChainAccountService.synchronize(
        keyringAccounts,
        KnownCaip2ChainId.Mainnet,
      );

      expect(synchronizeSpy).toHaveBeenCalledWith(
        keyringAccounts,
        KnownCaip2ChainId.Mainnet,
      );
    });
  });
});
