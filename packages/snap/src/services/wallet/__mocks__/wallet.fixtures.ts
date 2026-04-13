import { Keypair } from '@stellar/stellar-sdk';

import { bufferToUint8Array } from '../../../utils/buffer';
import { Wallet } from '../Wallet';

export const generateStellarAddress = () => Keypair.random().publicKey();

export const getTestWallet = ({
  seed,
  address,
}: {
  seed?: Uint8Array;
  address?: string;
} = {}): Wallet => {
  let keypair: Keypair;
  if (address) {
    keypair = Keypair.fromPublicKey(address);
  } else if (seed) {
    keypair = Keypair.fromRawEd25519Seed(bufferToUint8Array(seed));
  } else {
    keypair = Keypair.random();
  }
  return new Wallet(keypair);
};
