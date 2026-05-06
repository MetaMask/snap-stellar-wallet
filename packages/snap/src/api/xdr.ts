import { nonempty, refine, string } from '@metamask/superstruct';
import { base64 } from '@metamask/utils';
import { Networks, hash, xdr } from '@stellar/stellar-sdk';

import { bufferToUint8Array } from '../utils/buffer';

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

// SHA-256 of the Stellar mainnet passphrase. Cached so the refine below
// doesn't re-hash on every validation. This is the value the network compares
// against when verifying a Soroban authorization signature, so the embedded
// `networkId` of any preimage we agree to sign must equal it.
const MAINNET_NETWORK_ID = hash(bufferToUint8Array(Networks.PUBLIC, 'utf8'));

/**
 * Validation struct for a SEP-43 `signAuthEntry` payload: a base64-encoded
 * `HashIdPreimage` whose discriminant is `envelopeTypeSorobanAuthorization`
 * AND whose embedded `networkId` matches Stellar mainnet. Anything else is
 * rejected at the struct level so the handler can return -3 InvalidRequest.
 *
 * The `networkId` check matters because — unlike `signTransaction`, where the
 * network passphrase is supplied by the signer — `signAuthEntry` SHA-256s the
 * raw preimage and signs the digest as-is. The dapp therefore controls the
 * network the resulting signature is valid against, and a mainnet-only snap
 * must reject preimages bound to any other network even if the keyring `scope`
 * and `opts.networkPassphrase` look mainnet-y.
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
      const embeddedNetworkId = preimage.sorobanAuthorization().networkId();
      if (!MAINNET_NETWORK_ID.equals(embeddedNetworkId)) {
        return 'HashIdPreimage networkId is not Stellar mainnet';
      }
      return true;
    } catch {
      return 'Invalid HashIdPreimage XDR';
    }
  },
);
