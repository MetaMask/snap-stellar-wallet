import { type Infer } from '@metamask/superstruct';
import { definePattern } from '@metamask/utils';

/**
 * Validation struct for Stellar address: must be a string matching the Stellar address format.
 * We only support non-muxed addresses.
 */
export const StellarAddressStruct = definePattern(
  'StellarAddress',
  /^G[A-Z2-7]{55}$/u,
);

/**
 * Type for a Stellar address.
 */
export type StellarAddress = Infer<typeof StellarAddressStruct>;
