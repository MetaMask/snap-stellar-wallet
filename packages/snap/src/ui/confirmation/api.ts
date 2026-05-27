import type { GetPreferencesResult } from '@metamask/snaps-sdk';
import type { Infer } from '@metamask/superstruct';
import {
  enums,
  record,
  type,
  string,
  nullable,
  nonempty,
  union,
} from '@metamask/superstruct';

import type {
  KnownCaip2ChainId,
  KnownCaip19AssetIdOrSlip44Id,
} from '../../api';
import {
  KnownCaip19ClassicAssetStruct,
  KnownCaip19Sep41AssetStruct,
  KnownCaip19Slip44IdStruct,
  KnownCaip2ChainIdStruct,
  UuidStruct,
  XdrStruct,
} from '../../api';
import {
  ChangeTrustOptJsonRpcRequestStruct,
  ConfirmSendJsonRpcRequestStruct,
} from '../../handlers/clientRequest/api';

export type FeeData = {
  assetId: KnownCaip19AssetIdOrSlip44Id;
  symbol: string;
  iconUrl: string;
  amount: string;
};

export enum FetchStatus {
  Initial = 'initial',
  Fetching = 'fetching',
  Fetched = 'fetched',
  // eslint-disable-next-line @typescript-eslint/no-shadow
  Error = 'error',
}

export const ContextWithPricesStruct = type({
  tokenPrices: record(
    union([
      KnownCaip19Sep41AssetStruct,
      KnownCaip19ClassicAssetStruct,
      KnownCaip19Slip44IdStruct,
    ]),
    nullable(string()),
  ),
  tokenPricesFetchStatus: enums(Object.values(FetchStatus)),
  currency: nonempty(string()),
});

export const ContextWithTransactionScanStruct = type({
  transaction: nonempty(XdrStruct),
  transactionsFetchStatus: enums(Object.values(FetchStatus)),
  accountId: UuidStruct,
  scope: KnownCaip2ChainIdStruct,
  request: union([
    // we only support send and change trust transactions to scan the transaction
    ConfirmSendJsonRpcRequestStruct,
    ChangeTrustOptJsonRpcRequestStruct,
  ]),
});

export type ContextWithPrices = Infer<typeof ContextWithPricesStruct>;

export type ContextWithTransactionScan = Infer<
  typeof ContextWithTransactionScanStruct
>;

export enum ConfirmationInterfaceKey {
  ChangeTrustlineOptIn = 'ChangeTrustlineOptIn',
  ChangeTrustlineOptOut = 'ChangeTrustlineOptOut',
  SignMessage = 'SignMessage',
  SignTransaction = 'SignTransaction',
  SignAuthEntry = 'SignAuthEntry',
  ConfirmSendTransaction = 'ConfirmSendTransaction',
}

export const ConfirmationInterfaceKeyStruct = enums(
  Object.values(ConfirmationInterfaceKey),
);

/**
 * Cross-cutting confirmation context injected by {@link ConfirmationUXController}
 * before the caller's `renderContext` is merged in.
 */
export type ConfirmationBaseProps = Partial<ContextWithPrices> & {
  preferences: GetPreferencesResult;
  locale: string;
  scope: KnownCaip2ChainId;
  networkImage: string | null;
  origin: string;
  feeData?: FeeData;
};
