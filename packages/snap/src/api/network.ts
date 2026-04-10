/** Stellar Chain namespace */

import { enums } from '@metamask/superstruct';
import { KnownCaipNamespace } from '@metamask/utils';

/** Known CAIP-2 IDs */
/** Please see https://namespaces.chainagnostic.org/stellar/caip2 */
export enum KnownCaip2ChainId {
  Mainnet = `${KnownCaipNamespace.Stellar}:pubnet`,
  Testnet = `${KnownCaipNamespace.Stellar}:testnet`,
}

export const KnownCaip2ChainIdStruct = enums(Object.values(KnownCaip2ChainId));
