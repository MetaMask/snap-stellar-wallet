import { SLIP10Node } from '@metamask/key-tree';
import { hexToBytes } from '@metamask/utils';
import { Keypair } from '@stellar/stellar-sdk';

import {
  getTestWallet,
  generateStellarAddress,
} from './__mocks__/wallet.fixtures';
import { KeyDerivationException } from './exceptions';
import { WalletService } from './WalletService';
import { mockBip32Node } from '../../utils/__mocks__/fixtures';
import { bufferToUint8Array } from '../../utils/buffer';
import { StellarSnapException } from '../../utils/errors';
import { getBip32Entropy } from '../../utils/snap';
import { generateStellarKeyringAccount } from '../account/__mocks__/account.fixtures';
import { DerivedAccountAddressMismatchException } from '../account/exceptions';

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
    walletService = new WalletService();
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

    it('throws a KeyDerivationException if the keypair derivation fails', async () => {
      jest
        .mocked(getBip32Entropy)
        .mockRejectedValue(new Error('something went wrong'));

      await expect(
        walletService.deriveAddress({
          index: 0,
          entropySource: 'entropy-source-1',
        }),
      ).rejects.toThrow(
        new KeyDerivationException('Unable to derive keypair from entropy'),
      );
    });

    it('throws a StellarSnapException when getBip32Entropy rejects', async () => {
      jest
        .mocked(getBip32Entropy)
        .mockRejectedValue(
          new StellarSnapException('Failed to get BIP32 entropy from Snap'),
        );

      await expect(
        walletService.deriveAddress({
          index: 0,
          entropySource: 'entropy-source-1',
        }),
      ).rejects.toThrow(
        new StellarSnapException('Failed to get BIP32 entropy from Snap'),
      );
    });

    it('throws a KeyDerivationException when derived node is missing key material', async () => {
      jest.mocked(getBip32Entropy).mockResolvedValue({
        ...mockBip32Node,
        privateKey: undefined,
      });

      await expect(
        walletService.deriveAddress({
          index: 0,
          entropySource: 'entropy-source-1',
        }),
      ).rejects.toThrow(
        new KeyDerivationException('Derived node is missing key material'),
      );
    });
  });

  describe('getWalletResolver', () => {
    it('returns a resolver whose wallets match derivation order for successive indices', async () => {
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

      const resolver =
        await walletService.getWalletResolver('entropy-source-1');

      const addresses = [];
      for (const index of indices) {
        const wallet = await resolver(index);
        addresses.push(wallet.address);
      }

      const expected = derivedPrivateKeys.map((privateKey) =>
        Keypair.fromRawEd25519Seed(
          bufferToUint8Array(hexToBytes(privateKey)),
        ).publicKey(),
      );
      expect(addresses).toStrictEqual(expected);
      expect(fromJSONSpy).toHaveBeenCalledTimes(1);
    });

    it('throws a KeyDerivationException when loading the coin-type derivation node fails', async () => {
      jest
        .mocked(getBip32Entropy)
        .mockRejectedValue(new Error('something went wrong'));

      await expect(
        walletService.getWalletResolver('entropy-source-1'),
      ).rejects.toThrow(
        new KeyDerivationException('Unable to load coin-type derivation node'),
      );
    });

    it('throws a KeyDerivationException when deriving keypair at account index fails', async () => {
      jest.spyOn(SLIP10Node, 'fromJSON').mockResolvedValue({
        derive: jest.fn().mockRejectedValue(new Error('derive failed')),
      } as unknown as SLIP10Node);

      const resolver =
        await walletService.getWalletResolver('entropy-source-1');

      await expect(resolver(0)).rejects.toThrow(
        new KeyDerivationException('Unable to derive keypair at account index'),
      );
    });

    it('loads the SLIP10 coin-type node once per resolver', async () => {
      const fromJSONSpy = jest.spyOn(SLIP10Node, 'fromJSON').mockResolvedValue({
        derive: jest.fn().mockResolvedValue({
          privateKey:
            '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          publicKey:
            '0x2222222222222222222222222222222222222222222222222222222222222222',
        }),
      } as unknown as SLIP10Node);

      const resolver =
        await walletService.getWalletResolver('entropy-source-1');
      await resolver(0);

      expect(fromJSONSpy).toHaveBeenCalledTimes(1);
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
        generateStellarAddress(),
        'entropy-source-1',
        0,
      );

      await expect(walletService.resolveWallet(account)).rejects.toThrow(
        DerivedAccountAddressMismatchException,
      );
    });

    it('throws a KeyDerivationException if the keypair derivation fails', async () => {
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
        new KeyDerivationException('Unable to derive keypair from entropy'),
      );
    });
  });
});
