import { KeyringRequestStruct } from '@metamask/keyring-api';
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
  size,
  nonempty,
  assign,
  nullable,
  enums,
} from '@metamask/superstruct';
import type { Infer } from '@metamask/superstruct';
import { base64 } from '@metamask/utils';

import {
  KnownCaip19ClassicAssetStruct,
  KnownCaip19Sep41AssetStruct,
  KnownCaip19Slip44IdStruct,
} from '../../api';
import { StellarAddressStruct } from '../../api/address';
import { KnownCaip2ChainIdStruct } from '../../api/network';
import { Utf8StringStruct } from '../../api/string';
import { UuidStruct } from '../../api/uuid';
import { XdrStruct } from '../../api/xdr';

/** JSON-RPC methods supported by this snap's multichain keyring. */
export enum MultichainMethod {
  SignMessage = 'signMessage',
  SignTransaction = 'signTransaction',
}

/** Superstruct validator for {@link MultichainMethod} string values. */
export const MultichainMethodStruct = enums(Object.values(MultichainMethod));

/** Inferred union of supported multichain method names. */
export type MultichainMethodType = Infer<typeof MultichainMethodStruct>;

/**
 * Struct for validating createAccount options.
 * - entropySource: Optional string for the entropy source.
 * - index: Optional non-negative integer for the account derivation index.
 */
export const CreateAccountOptionsStruct = optional(
  object({
    entropySource: optional(nonempty(string())),
    index: optional(min(integer(), 0)),
    addressType: optional(nonempty(string())),
    scope: optional(nonempty(string())),
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
  scopes: size(array(KnownCaip2ChainIdStruct), 1, 1),
  entropySource: nonempty(string()),
  groupIndex: min(integer(), 0),
});

/**
 * Validation struct for the signMessage request.
 */
export const SignMessageRequestStruct = assign(
  KeyringRequestStruct,
  object({
    request: object({
      method: literal(MultichainMethod.SignMessage),
      params: object({
        message: nonempty(union([base64(string()), Utf8StringStruct])),
      }),
    }),
    scope: KnownCaip2ChainIdStruct,
    account: UuidStruct,
  }),
);

/**
 * Validation struct for the signMessage response.
 */
export const SignMessageResponseStruct = object({
  signature: nonempty(base64(string())),
});

/**
 * Validation struct for the signTransaction request.
 */
export const SignTransactionRequestStruct = assign(
  KeyringRequestStruct,
  object({
    request: object({
      method: literal(MultichainMethod.SignTransaction),
      params: object({
        transaction: XdrStruct,
      }),
    }),
    scope: KnownCaip2ChainIdStruct,
    account: UuidStruct,
  }),
);

/**
 * Validation struct for the listAccountTransactions request.
 */
export const ListAccountTransactionsRequestStruct = object({
  accountId: UuidStruct,
  pagination: object({
    limit: min(integer(), 1),
    next: optional(nullable(UuidStruct)),
  }),
});

/**
 * Validation struct for the signTransaction response.
 */
export const SignTransactionResponseStruct = object({
  signature: XdrStruct,
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
 * Validation struct for the listAccountAssets request.
 */
export const ListAccountAssetsRequestStruct = UuidStruct;

/**
 * Validation struct for the setSelectedAccounts request.
 */
export const SetSelectedAccountsRequestStruct = array(UuidStruct);

export const GetAccountBalancesRequestStruct = object({
  accountId: UuidStruct,
  assets: array(
    union([
      KnownCaip19Sep41AssetStruct,
      KnownCaip19ClassicAssetStruct,
      KnownCaip19Slip44IdStruct,
    ]),
  ),
});

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

/**
 * Type for the setSelectedAccounts request.
 */
export type SetSelectedAccountsRequest = Infer<
  typeof SetSelectedAccountsRequestStruct
>;

/**
 * Type for the signMessage request.
 */
export type SignMessageRequest = Infer<typeof SignMessageRequestStruct>;

/**
 * Type for the signMessage response.
 */
export type SignMessageResponse = Infer<typeof SignMessageResponseStruct>;

/**
 * Type for the signTransaction request.
 */
export type SignTransactionRequest = Infer<typeof SignTransactionRequestStruct>;

/**
 * Type for the signTransaction response.
 */
export type SignTransactionResponse = Infer<
  typeof SignTransactionResponseStruct
>;
