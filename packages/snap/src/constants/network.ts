/** Stellar Chain namespace */
/** please see https://namespaces.chainagnostic.org/stellar/caip2 */
export const ChainNameSpace = 'stellar';

/** Known CAIP-2 IDs */
/** please see https://namespaces.chainagnostic.org/stellar/caip2 */
export enum KnownCaip19ChainId {
  Mainnet = `${ChainNameSpace}:pubnet`,
  Testnet = `${ChainNameSpace}:testnet`,
}
