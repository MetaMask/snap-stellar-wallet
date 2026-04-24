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
 * Optional bag accepted by both SEP-43 sign methods.
 *
 * `submit` and `submitUrl` are intentionally omitted from the schema:
 * the snap signs only and rejects any caller asking for submission.
 *
 * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0043.md
 */
export const Sep43OptsStruct = object({
  networkPassphrase: optional(nonempty(string())),
  address: optional(StellarAddressStruct),
});

export type Sep43Opts = Infer<typeof Sep43OptsStruct>;

/**
 * Shape of the SEP-43 error envelope returned alongside the success fields.
 */
export const Sep43ErrorEnvelopeStruct = object({
  message: nonempty(string()),
  code: number(),
  ext: optional(array(string())),
});

export type Sep43ErrorEnvelope = Infer<typeof Sep43ErrorEnvelopeStruct>;

/**
 * Validation struct for the signMessage request.
 *
 * Params follow the SEP-43 `SignMessage` shape: a base64-encoded message and
 * the optional `opts` bag (`address`, `networkPassphrase`).
 */
export const SignMessageRequestStruct = assign(
  KeyringRequestStruct,
  object({
    request: object({
      method: literal(MultichainMethod.SignMessage),
      params: object({
        message: nonempty(base64(string())),
        opts: optional(Sep43OptsStruct),
      }),
    }),
    scope: KnownCaip2ChainIdStruct,
    account: UuidStruct,
  }),
);

/**
 * Validation struct for the signMessage response.
 *
 * `signedMessage` is base64-encoded on success; empty string on error.
 * `signerAddress` is the signer's G-address on success, or empty when
 * account resolution failed before we could determine the address.
 */
export const SignMessageResponseStruct = object({
  signedMessage: union([nonempty(base64(string())), literal('')]),
  signerAddress: union([StellarAddressStruct, literal('')]),
  error: optional(Sep43ErrorEnvelopeStruct),
});

/**
 * Validation struct for the signTransaction request.
 *
 * Params follow the SEP-43 `SignTransaction` shape: a base64-encoded
 * transaction envelope XDR and the optional `opts` bag (`address`,
 * `networkPassphrase`).
 */
export const SignTransactionRequestStruct = assign(
  KeyringRequestStruct,
  object({
    request: object({
      method: literal(MultichainMethod.SignTransaction),
      params: object({
        xdr: XdrStruct,
        opts: optional(Sep43OptsStruct),
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
 *
 * `signedTxXdr` is the signed transaction envelope as base64 XDR on success;
 * empty string on error.
 * `signerAddress` is the signer's G-address on success, or empty when
 * account resolution failed before we could determine the address.
 */
export const SignTransactionResponseStruct = object({
  signedTxXdr: union([XdrStruct, literal('')]),
  signerAddress: union([StellarAddressStruct, literal('')]),
  error: optional(Sep43ErrorEnvelopeStruct),
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
