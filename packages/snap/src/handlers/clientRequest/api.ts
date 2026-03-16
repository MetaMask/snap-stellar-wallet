import type { Infer } from '@metamask/superstruct';
import { enums, object, assign } from '@metamask/superstruct';

import {
  JsonRpcRequestStruct,
  KnownCaip2ChainIdStruct,
  StellarAddressStruct,
  KnownCaip19AssetStruct,
} from '../../api';

/**
 * Enum for the client request method.
 */
export enum ClientRequestMethod {
  SignChangeTrustline = 'signChangeTrustline',
}

/**
 * Validation struct for the client request method.
 */
export const ClientRequestMethodStruct = enums(
  Object.values(ClientRequestMethod),
);

/**
 * Validation struct for the signChangeTrustline JSON-RPC request.
 */
export const SignChangeTrustlineJsonRpcRequestStruct = assign(
  JsonRpcRequestStruct,
  object({
    method: ClientRequestMethodStruct,
    params: object({
      address: StellarAddressStruct,
      asset: KnownCaip19AssetStruct,
      scope: KnownCaip2ChainIdStruct,
    }),
  }),
);

/**
 * Type for the signChangeTrustline JSON-RPC request.
 */
export type SignChangeTrustlineJsonRpcRequest = Infer<
  typeof SignChangeTrustlineJsonRpcRequestStruct
>;
