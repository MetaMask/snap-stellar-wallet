import type { GetPreferencesResult } from '@metamask/snaps-sdk';
import { union } from '@metamask/snaps-sdk';
import type { Infer } from '@metamask/superstruct';
import {
  boolean,
  enums,
  optional,
  record,
  type,
  string,
  nullable,
  nonempty,
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
import {
  SecurityScanRequestStruct,
  TokenScanResultStruct,
  TokenSecurityScanRequestStruct,
  TransactionScanResultStruct,
} from '../../services/transaction-scan';
import type {
  SecurityScanRequest,
  TokenScanResult,
  TokenSecurityScanRequest,
  TransactionScanResult,
} from '../../services/transaction-scan';

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

export type ContextWithPrices = Infer<typeof ContextWithPricesStruct>;

const SecurityScanPreferencesStruct = type({
  useSecurityAlerts: boolean(),
  simulateOnChainActions: boolean(),
});

export const ContextWithSecurityScanStruct = type({
  preferences: SecurityScanPreferencesStruct,
  scan: optional(nullable(TransactionScanResultStruct)),
  scanFetchStatus: enums(Object.values(FetchStatus)),
  securityScanRequest: optional(SecurityScanRequestStruct),
});

export type ContextWithSecurityScan = Infer<
  typeof ContextWithSecurityScanStruct
>;

export const ContextWithTokenScanStruct = type({
  preferences: SecurityScanPreferencesStruct,
  tokenScan: optional(nullable(TokenScanResultStruct)),
  tokenScanFetchStatus: enums(Object.values(FetchStatus)),
  tokenScanRequest: optional(TokenSecurityScanRequestStruct),
});

export type ContextWithTokenScan = Infer<typeof ContextWithTokenScanStruct>;

/**
 * Context required to re-validate the pending transaction (time bounds, fees,
 * balance) against the latest on-chain state while the confirmation dialog is open.
 */
export const ContextWithTransactionValidationStruct = type({
  transaction: nonempty(XdrStruct),
  transactionsFetchStatus: enums(Object.values(FetchStatus)),
  accountId: UuidStruct,
  scope: KnownCaip2ChainIdStruct,
  // Only send and change-trust transactions are re-validated.
  request: union([
    ConfirmSendJsonRpcRequestStruct,
    ChangeTrustOptJsonRpcRequestStruct,
  ]),
});

export type ContextWithTransactionValidation = Infer<
  typeof ContextWithTransactionValidationStruct
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
  scan?: TransactionScanResult | null;
  scanFetchStatus?: FetchStatus;
  securityScanRequest?: SecurityScanRequest;
  tokenScan?: TokenScanResult | null;
  tokenScanFetchStatus?: FetchStatus;
  tokenScanRequest?: TokenSecurityScanRequest;
  transactionsFetchStatus?: FetchStatus;
  preferences: GetPreferencesResult;
  locale: string;
  scope: KnownCaip2ChainId;
  networkImage: string | null;
  origin: string;
  feeData?: FeeData;
};
