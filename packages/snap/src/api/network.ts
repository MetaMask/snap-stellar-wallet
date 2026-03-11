/** Stellar Chain namespace */

import { enums } from '@metamask/superstruct';

/** Please see https://namespaces.chainagnostic.org/stellar/caip2 */
export const ChainNamespace = 'stellar';

/** Known CAIP-2 IDs */
/** Please see https://namespaces.chainagnostic.org/stellar/caip2 */
export enum KnownCaip2ChainId {
  Mainnet = `${ChainNamespace}:pubnet`,
  Testnet = `${ChainNamespace}:testnet`,
}

export const KnownCaip2ChainIdStruct = enums(Object.values(KnownCaip2ChainId));
