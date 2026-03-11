import {
  object,
  min,
  optional,
  string,
  integer,
  enums,
  type,
  pattern,
  array,
  literal,
  number,
  union,
} from '@metamask/superstruct';
import type { Infer } from '@metamask/superstruct';

import { KnownCaip2ChainId } from '../../constants';
import { UuidStruct } from '../../structs';

/**
 * Validation struct for Stellar address: must be a string matching the Stellar address format.
 * We only support non-muxed addresses.
 */
export const StellarAddressStruct = pattern(string(), /^G[A-Z2-7]{55}$/u);

/**
 * Enum of Stellar Multichain API methods that are handled via submitRequest.
 */
export enum StellarMultichainMethod {
  SignMessage = 'signMessage',
  SignTransaction = 'signTransaction',
}

/**
 * Struct for validating createAccount options.
 * - entropySource: Optional string for the entropy source.
 * - index: Optional non-negative integer for the account derivation index.
 */
export const CreateAccountOptionsStruct = optional(
  object({
    entropySource: optional(string()),
    index: optional(min(integer(), 0)),
    addressType: optional(string()),
    scope: optional(string()),
    metamask: optional(
      object({
        correlationId: optional(string()),
      }),
    ),
  }),
);

/**
 * Validation struct for the Stellar CAIP-2 chain ID.
 */
export const CaipChainIdStruct = enums(Object.values(KnownCaip2ChainId));

/**
 * Validation struct for the resolveAccountAddress JSON-RPC request.
 */
export const ResolveAccountAddressJsonRpcRequestStruct = object({
  jsonrpc: literal('2.0'),
  id: union([string(), number(), literal(null)] as const),
  method: enums(Object.values(StellarMultichainMethod)),
  params: type({ address: StellarAddressStruct }),
});

/**
 * Validation struct for the resolveAccountAddress request.
 */
export const ResolveAccountAddressRequestStruct = object({
  request: ResolveAccountAddressJsonRpcRequestStruct,
  scope: CaipChainIdStruct,
});

/**
 * Validation struct for the discoverAccounts request.
 */
export const DiscoverAccountsStruct = object({
  scopes: array(CaipChainIdStruct),
  entropySource: string(),
  groupIndex: min(integer(), 0),
});

/**
 * Validation struct for the getAccount request.
 */
export const GetAccountRequestStruct = UuidStruct;

/**
 * Validation struct for the deleteAccount request.
 */
export const DeleteAccountRequestStruct = UuidStruct;

/**
 * Validation struct for the setSelectedAccounts request.
 */
export const SetSelectedAccountsRequestStruct = array(UuidStruct);

/**
 * The options for the createAccount method.
 */
export type CreateAccountOptions = Infer<typeof CreateAccountOptionsStruct>;

/**
 * Type for the resolveAccountAddress request.
 */
export type ResolveAccountAddressJsonRpcRequest = Infer<
  typeof ResolveAccountAddressJsonRpcRequestStruct
>;

/**
 * Type for a Stellar address.
 */
export type StellarAddress = Infer<typeof StellarAddressStruct>;

/**
 * Type for the getAccount request.
 */
export type GetAccountRequest = Infer<typeof GetAccountRequestStruct>;

/**
 * Type for the deleteAccount request.
 */
export type DeleteAccountRequest = Infer<typeof DeleteAccountRequestStruct>;

/**
 * Type for a CAIP-2 chain ID.
 */
export type CaipChainId = Infer<typeof CaipChainIdStruct>;
