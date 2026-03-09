import { assert, hexToBytes } from '@metamask/utils';
import { Keypair } from '@stellar/stellar-sdk';

import { KeypairService } from './KeypairService';
import { logger } from '../../utils';
import { mockBip32Node } from '../../utils/__mocks__/fixtures';
import { getBip32Entropy } from '../../utils/snap';

jest.mock('../../utils/logger');
jest.mock('../../utils/snap');

describe('KeypairService', () => {
  let keypairService: KeypairService;

  beforeEach(() => {
    keypairService = new KeypairService({ logger });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('deriveAddress', () => {
    const index = 0;
    const entropySource = 'entropy-source-1';

    it('derive an address', async () => {
      jest.mocked(getBip32Entropy).mockResolvedValue(mockBip32Node);

      assert(mockBip32Node.privateKey);

      const expectedAddress = Keypair.fromRawEd25519Seed(
        hexToBytes(mockBip32Node.privateKey) as Buffer,
      ).publicKey();

      const result = await keypairService.deriveAddress({
        index,
        entropySource,
      });

      expect(result).toStrictEqual({
        derivationPath: "m/44'/148'/0'",
        address: expectedAddress,
      });
    });

    it('throws an error if the private key or public key is not available from SNAP bip32 entropy', async () => {
      jest.mocked(getBip32Entropy).mockResolvedValue({
        ...mockBip32Node,
        privateKey: undefined,
      });

      await expect(
        keypairService.deriveAddress({ index, entropySource }),
      ).rejects.toThrow(
        'Key derivation failed. Please check your connection and try again.',
      );
    });

    it('throws an error if the address is not available', async () => {
      jest.mocked(getBip32Entropy).mockResolvedValue(mockBip32Node);

      jest.spyOn(Keypair, 'fromRawEd25519Seed').mockReturnValue({
        publicKey: () => null,
      } as unknown as Keypair);

      await expect(
        keypairService.deriveAddress({ index, entropySource }),
      ).rejects.toThrow(
        'Key derivation failed. Please check your connection and try again.',
      );
    });
  });
});
