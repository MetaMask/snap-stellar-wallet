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

/**
 * Validation struct for a SEP-43 `signAuthEntry` payload: a base64-encoded
 * `HashIdPreimage` whose discriminant is `envelopeTypeSorobanAuthorization`
 * (i.e. a Soroban auth-entry preimage). Anything else is rejected at the
 * struct level so the handler can return -3 InvalidRequest.
 */
export const HashIdPreimageXdrStruct = refine(
  nonempty(base64(string())),
  'valid_soroban_auth_preimage',
  (value: string) => {
    try {
      const preimage = xdr.HashIdPreimage.fromXDR(value, 'base64');
      if (
        preimage.switch() !==
        xdr.EnvelopeType.envelopeTypeSorobanAuthorization()
      ) {
        return 'HashIdPreimage is not a Soroban authorization preimage';
      }
      return true;
    } catch {
      return 'Invalid HashIdPreimage XDR';
    }
  },
);
