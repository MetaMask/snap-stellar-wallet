import {
  array,
  enums,
  literal,
  nonempty,
  number,
  object,
  optional,
  string,
  union,
} from '@metamask/superstruct';
import type { Infer } from '@metamask/superstruct';
import { base64 } from '@metamask/utils';

import { StellarAddressStruct } from '../../api/address';
import { KnownCaip2ChainIdStruct } from '../../api/network';
import { UuidStruct } from '../../api/uuid';
import { XdrStruct } from '../../api/xdr';

/**
 * SEP-43 method names exposed via `onRpcRequest`.
 *
 * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0043.md
 */
export enum Sep43Method {
  SignMessage = 'SignMessage',
  SignTransaction = 'SignTransaction',
}

export const Sep43MethodStruct = enums(Object.values(Sep43Method));

/**
 * Optional bag accepted by both SEP-43 methods.
 *
 * `submit` and `submitUrl` are intentionally omitted from the schema:
 * the snap signs only and rejects any caller asking for submission.
 */
export const Sep43OptsStruct = object({
  networkPassphrase: optional(nonempty(string())),
  address: optional(StellarAddressStruct),
});

export type Sep43Opts = Infer<typeof Sep43OptsStruct>;

/**
 * SEP-43 SignMessage params.
 */
export const Sep43SignMessageParamsStruct = object({
  message: nonempty(base64(string())),
  opts: optional(Sep43OptsStruct),
});

export type Sep43SignMessageParams = Infer<typeof Sep43SignMessageParamsStruct>;

/**
 * SEP-43 SignTransaction params.
 */
export const Sep43SignTransactionParamsStruct = object({
  xdr: XdrStruct,
  opts: optional(Sep43OptsStruct),
});

export type Sep43SignTransactionParams = Infer<
  typeof Sep43SignTransactionParamsStruct
>;

/**
 * Wrapper request as it arrives at `onRpcRequest`.
 *
 * `account` is the keyring account UUID resolved by the multichain middleware
 * from the dapp's session-connected accounts (CAIP-25 caveat).
 */
const Sep43RequestWrapper = {
  scope: KnownCaip2ChainIdStruct,
  account: UuidStruct,
  origin: nonempty(string()),
  id: union([string(), number(), literal(null)] as const),
};

export const Sep43SignMessageRequestStruct = object({
  ...Sep43RequestWrapper,
  request: object({
    method: literal(Sep43Method.SignMessage),
    params: Sep43SignMessageParamsStruct,
  }),
});

export type Sep43SignMessageRequest = Infer<
  typeof Sep43SignMessageRequestStruct
>;

export const Sep43SignTransactionRequestStruct = object({
  ...Sep43RequestWrapper,
  request: object({
    method: literal(Sep43Method.SignTransaction),
    params: Sep43SignTransactionParamsStruct,
  }),
});

export type Sep43SignTransactionRequest = Infer<
  typeof Sep43SignTransactionRequestStruct
>;

/**
 * Shape of the SEP-43 error envelope that may sit alongside the success fields.
 */
export const Sep43ErrorEnvelopeStruct = object({
  message: nonempty(string()),
  code: number(),
  ext: optional(array(string())),
});

export type Sep43ErrorEnvelope = Infer<typeof Sep43ErrorEnvelopeStruct>;

/**
 * SEP-43 SignMessage response.
 *
 * `signedMessage` is base64-encoded on success; empty string on error.
 * `signerAddress` is the signer's G-address on success, or empty when
 * account resolution failed before we could determine the address.
 */
export const Sep43SignMessageResponseStruct = object({
  signedMessage: union([nonempty(base64(string())), literal('')]),
  signerAddress: union([StellarAddressStruct, literal('')]),
  error: optional(Sep43ErrorEnvelopeStruct),
});

export type Sep43SignMessageResponse = Infer<
  typeof Sep43SignMessageResponseStruct
>;

/**
 * SEP-43 SignTransaction response.
 *
 * `signedTxXdr` is the signed transaction envelope as base64 XDR on success;
 * empty string on error.
 * `signerAddress` is the signer's G-address on success, or empty when
 * account resolution failed before we could determine the address.
 */
export const Sep43SignTransactionResponseStruct = object({
  signedTxXdr: union([XdrStruct, literal('')]),
  signerAddress: union([StellarAddressStruct, literal('')]),
  error: optional(Sep43ErrorEnvelopeStruct),
});

export type Sep43SignTransactionResponse = Infer<
  typeof Sep43SignTransactionResponseStruct
>;
