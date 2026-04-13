import { refine, string, nonempty, type Infer } from '@metamask/superstruct';
import { StrKey } from '@stellar/stellar-sdk';

/**
 * Validation struct for Stellar address: must be a string matching the Stellar address format and checksum.
 * We only support non-muxed addresses.
 */
export const StellarAddressStruct = refine(
  nonempty(string()),
  'stellar_address',
  (value: string) => {
    try {
      if (!StrKey.isValidEd25519PublicKey(value)) {
        return 'Invalid Stellar address';
      }
      return true;
    } catch {
      return 'Invalid Stellar address';
    }
  },
);

/**
 * Type for a Stellar address.
 */
export type StellarAddress = Infer<typeof StellarAddressStruct>;
