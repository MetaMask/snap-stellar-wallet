import {
  object,
  min,
  optional,
  string,
  integer,
  type,
  array,
  literal,
  number,
  union,
} from '@metamask/superstruct';
import type { Infer } from '@metamask/superstruct';

import {
  StellarAddressStruct,
  UuidStruct,
  MultichainMethodStruct,
  KnownCaip2ChainIdStruct,
} from '../../api';

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
 * Validation struct for the resolveAccountAddress JSON-RPC request.
 */
export const ResolveAccountAddressJsonRpcRequestStruct = object({
  jsonrpc: literal('2.0'),
  id: union([string(), number(), literal(null)] as const),
  method: MultichainMethodStruct,
  params: type({ address: StellarAddressStruct }),
});

/**
 * Validation struct for the resolveAccountAddress request.
 */
export const ResolveAccountAddressRequestStruct = object({
  request: ResolveAccountAddressJsonRpcRequestStruct,
  scope: KnownCaip2ChainIdStruct,
});

/**
 * Validation struct for the discoverAccounts request.
 */
export const DiscoverAccountsStruct = object({
  scopes: array(KnownCaip2ChainIdStruct),
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
 * Type for the getAccount request.
 */
export type GetAccountRequest = Infer<typeof GetAccountRequestStruct>;

/**
 * Type for the deleteAccount request.
 */
export type DeleteAccountRequest = Infer<typeof DeleteAccountRequestStruct>;
