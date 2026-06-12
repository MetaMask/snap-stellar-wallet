import type { Infer } from '@metamask/superstruct';
import { definePattern } from '@metamask/utils';

/**
 * Validation struct for Stellar transaction hashes returned by RPC.
 */
export const StellarTransactionHashStruct = definePattern(
  'StellarTransactionHash',
  /^[0-9a-f]{64}$/iu,
);

export type TransactionId = Infer<typeof StellarTransactionHashStruct>;
