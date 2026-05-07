import { SLIP10Node } from '@metamask/key-tree';
import { hexToBytes } from '@metamask/utils';
import { Keypair } from '@stellar/stellar-sdk';

import { getTestWallet } from './__mocks__/wallet.fixtures';
import { WalletServiceException } from './exceptions';
import { WalletService } from './WalletService';
import { mockBip32Node } from '../../utils/__mocks__/fixtures';
import { bufferToUint8Array } from '../../utils/buffer';
import { logger } from '../../utils/logger';
import { getBip32Entropy } from '../../utils/snap';
import { generateStellarKeyringAccount } from '../account/__mocks__/account.fixtures';
import { DerivedAccountAddressMismatchException } from '../account/exceptions';

jest.mock('../../utils/logger');
jest.mock('../../utils/snap');

describe('WalletService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  let walletService: WalletService;

  const seed = hexToBytes(
    '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getBip32Entropy).mockResolvedValue(mockBip32Node);
    walletService = new WalletService({ logger });
  });

  describe('deriveAddress', () => {
    it('derives an address', async () => {
      const wallet = getTestWallet({ seed });
      const address = await walletService.deriveAddress({
        index: 0,
        entropySource: 'entropy-source-1',
      });

      expect(address).toStrictEqual(wallet.address);
    });

    it('throws a WalletServiceException if the keypair derivation fails', async () => {
      jest
        .mocked(getBip32Entropy)
        .mockRejectedValue(new Error('something went wrong'));

      await expect(
        walletService.deriveAddress({
          index: 0,
          entropySource: 'entropy-source-1',
        }),
      ).rejects.toThrow(WalletServiceException);
    });
  });

  describe('deriveAddressesByIndices', () => {
    it('returns addresses in the same order as indices', async () => {
      const indices = [2, 5, 7];
      const derivedPrivateKeys = [
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      ];
      const fromJSONSpy = jest.spyOn(SLIP10Node, 'fromJSON').mockResolvedValue({
        derive: jest
          .fn()
          .mockResolvedValueOnce({
            privateKey: derivedPrivateKeys[0],
            publicKey:
              '0x1111111111111111111111111111111111111111111111111111111111111111',
          })
          .mockResolvedValueOnce({
            privateKey: derivedPrivateKeys[1],
            publicKey:
              '0x2222222222222222222222222222222222222222222222222222222222222222',
          })
          .mockResolvedValueOnce({
            privateKey: derivedPrivateKeys[2],
            publicKey:
              '0x3333333333333333333333333333333333333333333333333333333333333333',
          }),
      } as unknown as SLIP10Node);

      const result = await walletService.deriveAddressesByIndices({
        indices,
        entropySource: 'entropy-source-1',
      });

      const expected = derivedPrivateKeys.map((privateKey) =>
        Keypair.fromRawEd25519Seed(
          bufferToUint8Array(hexToBytes(privateKey)),
        ).publicKey(),
      );
      expect(result).toStrictEqual(expected);
      expect(fromJSONSpy).toHaveBeenCalledTimes(1);
    });

    it('returns an empty array for empty indices input', async () => {
      const fromJSONSpy = jest.spyOn(SLIP10Node, 'fromJSON');

      const result = await walletService.deriveAddressesByIndices({
        indices: [],
        entropySource: 'entropy-source-1',
      });

      expect(result).toStrictEqual([]);
      expect(fromJSONSpy).not.toHaveBeenCalled();
    });
  });

  describe('resolveWallet', () => {
    it('returns a wallet whose address matches the keyring row', async () => {
      const kp = Keypair.fromRawEd25519Seed(bufferToUint8Array(seed));
      const account = generateStellarKeyringAccount(
        globalThis.crypto.randomUUID(),
        kp.publicKey(),
        'entropy-source-1',
        0,
      );

      const wallet = await walletService.resolveWallet(account);

      expect(wallet.address).toStrictEqual(kp.publicKey());
    });

    it('throws DerivedAccountAddressMismatchException when derivation does not match stored address', async () => {
      const account = generateStellarKeyringAccount(
        globalThis.crypto.randomUUID(),
        Keypair.random().publicKey(),
        'entropy-source-1',
        0,
      );

      await expect(walletService.resolveWallet(account)).rejects.toThrow(
        DerivedAccountAddressMismatchException,
      );
    });

    it('throws a WalletServiceException if the keypair derivation fails', async () => {
      jest
        .mocked(getBip32Entropy)
        .mockRejectedValue(new Error('something went wrong'));
      const kp = Keypair.fromRawEd25519Seed(bufferToUint8Array(seed));
      const account = generateStellarKeyringAccount(
        globalThis.crypto.randomUUID(),
        kp.publicKey(),
        'entropy-source-1',
        0,
      );

      await expect(walletService.resolveWallet(account)).rejects.toThrow(
        WalletServiceException,
      );
    });
  });
});
