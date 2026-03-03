/** Stellar Chain namespace */
/** please see https://namespaces.chainagnostic.org/stellar/caip2 */
export const ChainNamespace = 'stellar';

/** Known CAIP-2 IDs */
/** please see https://namespaces.chainagnostic.org/stellar/caip2 */
export enum KnownCaip2ChainId {
  Mainnet = `${ChainNamespace}:pubnet`,
  Testnet = `${ChainNamespace}:testnet`,
}
