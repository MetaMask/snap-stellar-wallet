import type { JsonSLIP10Node } from '@metamask/key-tree';
import type { EntropySource } from '@metamask/snaps-sdk';

/** Default BIP32 node for tests. Use with getBip32Entropy.mockResolvedValue(mockBip32Node) in beforeEach (resetMocks clears implementations). */
export const mockBip32Node: JsonSLIP10Node = {
  depth: 0,
  parentFingerprint: 0,
  index: 0,
  chainCode: 'chain-code-123',
  curve: 'ed25519',
  publicKey:
    '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  privateKey:
    '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
};

export const mockEntropySources: EntropySource[] = [
  {
    name: 'entropy-source-1',
    id: 'entropy-source-1',
    type: 'mnemonic',
    primary: true,
  },
];
