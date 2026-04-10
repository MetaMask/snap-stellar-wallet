import { nonempty, refine, string } from '@metamask/superstruct';
import { base64 } from '@metamask/utils';
import { xdr } from '@stellar/stellar-sdk';

/**
 * Validation struct for XDR: must be a valid base64 encoded XDR string.
 */
export const XdrStruct = refine(
  nonempty(base64(string())),
  'valid_xdr',
  (value: string) => {
    try {
      if (!xdr.TransactionEnvelope.validateXDR(value, 'base64')) {
        return 'Invalid XDR';
      }
      return true;
    } catch {
      return 'Invalid XDR';
    }
  },
);
