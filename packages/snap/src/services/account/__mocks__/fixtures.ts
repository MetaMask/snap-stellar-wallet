import { Keypair } from '@stellar/stellar-sdk';

import { KnownCaip2ChainId } from '../../../api';
import { KeypairService } from '../../wallet';
import type { StellarKeyringAccount } from '../AccountsRepository';

export const generateStellarKeyringAccount = (
  id: string,
  address: string,
  entropySource: string,
  index: number,
): StellarKeyringAccount => ({
  id,
  address,
  type: 'any:account',
  options: {
    entropy: {
      type: 'mnemonic',
      id: entropySource,
      derivationPath: KeypairService.getDerivationPath(index),
      groupIndex: index,
    },
    exportable: true,
  },
  methods: ['signMessage', 'signTransaction'],
  scopes: [KnownCaip2ChainId.Mainnet],
  entropySource,
  derivationPath: KeypairService.getDerivationPath(index),
  index,
});

export const generateMockStellarKeyringAccounts = (
  count: number,
  entropySource: string,
): StellarKeyringAccount[] =>
  Array.from({ length: count }, (_, index) =>
    generateStellarKeyringAccount(
      globalThis.crypto.randomUUID(),
      Keypair.random().publicKey(),
      entropySource,
      index,
    ),
  );
