import { hexToBytes } from '@metamask/utils';
import { Keypair } from '@stellar/stellar-sdk';

import { KnownCaip2ChainId } from '../../api';
import {
  createMockAccountWithBalances,
  DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
  mockOnChainAccountService,
} from './__mocks__/onChainAccount.fixtures';
import { OnChainAccount } from './OnChainAccount';
import { bufferToUint8Array } from '../../utils/buffer';
import type { StellarKeyringAccount } from '../account';
import { generateStellarKeyringAccount } from '../account/__mocks__/account.fixtures';
import { AccountService } from '../account/AccountService';
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
  });

  describe('discoverOnChainAccount', () => {
    it('returns derived account when activated on the network', async () => {
      const mockAccount = generateStellarKeyringAccount(
        globalThis.crypto.randomUUID(),
        Keypair.fromRawEd25519Seed(bufferToUint8Array(seed)).publicKey(),
        'entropy-source-default',
        0,
      );
      const deriveKeyringAccountSpy = jest
        .spyOn(AccountService.prototype, 'deriveKeyringAccount')
        .mockResolvedValue(mockAccount);
      const { getAccountOrNullSpy } = getNetworkServiceSpies();
      const wallet = getTestWallet({ seed });
      getAccountOrNullSpy.mockResolvedValue(
        new OnChainAccount(
          createMockAccountWithBalances(
            wallet.address,
            '1',
            DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
          ),
          KnownCaip2ChainId.Mainnet,
        ),
      );

      const { onChainAccountService } = mockOnChainAccountService();
      const account = await onChainAccountService.discoverOnChainAccount({
        entropySource: mockAccount.entropySource,
        index: mockAccount.index,
        scope: KnownCaip2ChainId.Mainnet,
      });

      expect(deriveKeyringAccountSpy).toHaveBeenCalledWith({
        entropySource: mockAccount.entropySource,
        index: mockAccount.index,
      });
      expect(account).toStrictEqual(mockAccount);
    });

    it('returns null when the account is not activated on the Stellar network', async () => {
      const mockAccount = generateStellarKeyringAccount(
        globalThis.crypto.randomUUID(),
        Keypair.random().publicKey(),
        'entropy-source-default',
        0,
      );
      jest
        .spyOn(AccountService.prototype, 'deriveKeyringAccount')
        .mockResolvedValue(mockAccount);
      const { getAccountOrNullSpy } = getNetworkServiceSpies();
      getAccountOrNullSpy.mockResolvedValue(null);

      const { onChainAccountService } = mockOnChainAccountService();
      const account = await onChainAccountService.discoverOnChainAccount({
        entropySource: mockAccount.entropySource,
        index: mockAccount.index,
        scope: KnownCaip2ChainId.Mainnet,
      });

      expect(account).toBeNull();
    });
  });

  describe('isAccountActivated', () => {
    it('returns true when getAccountOrNull returns an account', async () => {
      const { getAccountOrNullSpy } = getNetworkServiceSpies();
      const wallet = getTestWallet({ seed });
      const onChain = new OnChainAccount(
        createMockAccountWithBalances(
          wallet.address,
          '1',
          DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
        ),
        KnownCaip2ChainId.Mainnet,
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
    it('returns loaded account when id matches keyring address', async () => {
      const signer = Keypair.fromRawEd25519Seed(bufferToUint8Array(seed));
      const mockAccount: StellarKeyringAccount = generateStellarKeyringAccount(
        globalThis.crypto.randomUUID(),
        signer.publicKey(),
        'entropy-source-1',
        0,
      );
      const loaded = new OnChainAccount(
        createMockAccountWithBalances(
          signer.publicKey(),
          '1',
          DEFAULT_MOCK_ACCOUNT_WITH_BALANCES,
        ),
        KnownCaip2ChainId.Mainnet,
      );
      const { loadOnChainAccountSpy } = getNetworkServiceSpies();
      loadOnChainAccountSpy.mockResolvedValue(loaded);

      const { onChainAccountService } = mockOnChainAccountService();
      const result = await onChainAccountService.resolveOnChainAccount(
        mockAccount,
        KnownCaip2ChainId.Mainnet,
      );

      expect(result.accountId).toStrictEqual(signer.publicKey());
      expect(loadOnChainAccountSpy).toHaveBeenCalledWith(
        mockAccount.address,
        KnownCaip2ChainId.Mainnet,
      );
    });
  });
});
