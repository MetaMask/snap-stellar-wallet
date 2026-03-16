import { Keypair } from '@stellar/stellar-sdk';

export const generateStellarAddress = () => Keypair.random().publicKey();
