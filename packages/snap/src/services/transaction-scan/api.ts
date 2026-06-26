/* eslint-disable @typescript-eslint/naming-convention */
import type { Infer } from '@metamask/superstruct';
import {
  array,
  enums,
  literal,
  nonempty,
  nullable,
  number,
  optional,
  record,
  string,
  type,
  union,
  unknown,
} from '@metamask/superstruct';

import { KnownCaip2ChainId, XdrStruct } from '../../api';

/**
 * TransactionScanErrorId
 *
 * Error IDs for the transaction scan.
 * These are used to map error messages to localized messages for the transaction alert.
 *
 * Values are lowercase and punctuation-free so they match the normalized API
 * error codes looked up in {@link TransactionAlert} (`ERROR_MESSAGE_IDS`).
 *
 * @see packages/snap/src/ui/confirmation/components/TransactionAlert.tsx
 */
export enum TransactionScanErrorId {
  InsufficientBalance = 'insufficientbalance',
  InsufficientFunds = 'insufficientfunds',
  InvalidTransaction = 'invalidtransaction',
  InvalidAddress = 'invalidaddress',
  NoTrustline = 'notrustline',
  TransactionExpired = 'transactionexpired',
}

/** TransactionScanOption - Options for the transaction scan. */
export enum TransactionScanOption {
  Simulation = 'simulation',
  Validation = 'validation',
}

/** TransactionScanValidationType */
export enum TransactionScanValidationType {
  Benign = 'Benign',
  Warning = 'Warning',
  Malicious = 'Malicious',
}

/** AssetChangeDirection - Direction of an estimated balance change relative to the signer. */
export enum AssetChangeDirection {
  In = 'in',
  Out = 'out',
}

/** Security Alerts API chain identifier. */
export type SecurityAlertsChain = 'pubnet' | 'testnet' | 'futurenet';

export type SecurityAlertsMetadata =
  | {
      type: 'wallet';
      url: string;
    }
  | {
      type: 'in_app';
    };

/**
 * Request body sent to `POST /stellar/transaction/scan`.
 */
export type SecurityAlertsApiRequest = {
  account_address: string;
  chain: SecurityAlertsChain;
  metadata: SecurityAlertsMetadata;
  transaction: string;
  options?: TransactionScanOption[];
};

/** ScanTransactionRequest */
export const SecurityScanRequestStruct = type({
  accountAddress: string(),
  origin: string(),
  scope: enums(Object.values(KnownCaip2ChainId)),
  transaction: string(),
});

export const ScanTransactionRequestStruct = type({
  accountAddress: nonempty(string()),
  origin: string(),
  scope: enums(Object.values(KnownCaip2ChainId)),
  transaction: XdrStruct,
  options: optional(array(enums(Object.values(TransactionScanOption)))),
});

export type SecurityScanRequest = Infer<typeof SecurityScanRequestStruct>;

export type ScanTransactionRequest = Infer<typeof ScanTransactionRequestStruct>;

/** StellarTransactionScanResponse */
const StellarAssetTransferDetailsStruct = type({
  raw_value: number(),
  value: number(),
  summary: optional(nullable(string())),
  usd_price: optional(nullable(number())),
});

export const StellarClassicAssetDetailsStruct = type({
  type: literal('ASSET'),
  code: string(),
  issuer: string(),
  org_name: string(),
  org_url: string(),
});

export const StellarNativeAssetDetailsStruct = type({
  type: literal('NATIVE'),
  code: literal('XLM'),
});

export const StellarSep41AssetDetailsStruct = type({
  type: literal('SEP41'),
  address: string(),
  name: string(),
  symbol: string(),
  decimals: number(),
});

/** Catch-all asset shape so Blockaid responses with unsupported types still parse. */
export const StellarUnknownAssetDetailsStruct = type({
  type: string(),
});

const StellarAssetDetailsStruct = union([
  StellarNativeAssetDetailsStruct,
  StellarClassicAssetDetailsStruct,
  StellarSep41AssetDetailsStruct,
  StellarUnknownAssetDetailsStruct,
]);

export const StellarAssetDiffStruct = type({
  asset: StellarAssetDetailsStruct,
  asset_type: string(),
  in: optional(nullable(StellarAssetTransferDetailsStruct)),
  out: optional(nullable(StellarAssetTransferDetailsStruct)),
});

const StellarSimulationSuccessStruct = type({
  status: literal('Success'),
  account_summary: type({
    account_assets_diffs: optional(array(StellarAssetDiffStruct)),
    account_exposures: optional(array(unknown())),
    account_ownerships_diff: optional(array(unknown())),
    total_usd_diff: optional(
      type({
        in: number(),
        out: number(),
        total: optional(number()),
      }),
    ),
  }),
  assets_ownership_diff: optional(record(string(), unknown())),
  address_details: optional(array(unknown())),
  assets_diffs: optional(record(string(), array(StellarAssetDiffStruct))),
  exposures: optional(record(string(), array(unknown()))),
});

const StellarSimulationErrorStruct = type({
  status: literal('Error'),
  error: string(),
});

const StellarValidationSuccessStruct = type({
  status: literal('Success'),
  result_type: enums(Object.values(TransactionScanValidationType)),
  classification: optional(string()),
  description: optional(string()),
  reason: optional(string()),
  features: optional(array(unknown())),
});

const StellarValidationErrorStruct = type({
  status: literal('Error'),
  error: string(),
});

export const StellarTransactionScanResponseStruct = type({
  simulation: optional(
    nullable(
      union([StellarSimulationSuccessStruct, StellarSimulationErrorStruct]),
    ),
  ),
  validation: optional(
    nullable(
      union([StellarValidationSuccessStruct, StellarValidationErrorStruct]),
    ),
  ),
});

export type StellarAssetDiff = Infer<typeof StellarAssetDiffStruct>;

export type StellarTransactionScanResponse = Infer<
  typeof StellarTransactionScanResponseStruct
>;

/** TransactionScanResult */
const TransactionScanAssetChangeStruct = type({
  type: enums(Object.values(AssetChangeDirection)),
  value: nullable(string()),
  price: nullable(number()),
  symbol: string(),
  name: string(),
  logo: nullable(string()),
});

const TransactionScanValidationStruct = type({
  type: nullable(enums(Object.values(TransactionScanValidationType))),
  reason: nullable(string()),
  description: nullable(string()),
});

const TransactionScanErrorStruct = type({
  type: nullable(
    enums(Object.values(['simulation', 'validation', 'response'])),
  ),
  code: nullable(string()),
  message: nullable(string()),
});

export const TransactionScanResultStruct = type({
  status: enums(['SUCCESS', 'ERROR']),
  estimatedChanges: type({
    assets: array(TransactionScanAssetChangeStruct),
  }),
  validation: nullable(TransactionScanValidationStruct),
  error: nullable(TransactionScanErrorStruct),
});

export type TransactionScanAssetChange = Infer<
  typeof TransactionScanAssetChangeStruct
>;

export type TransactionScanResult = Infer<typeof TransactionScanResultStruct>;

export type TransactionScanEstimatedChanges =
  TransactionScanResult['estimatedChanges'];

export type TransactionScanStatus = TransactionScanResult['status'];

export type TransactionScanError = Infer<typeof TransactionScanErrorStruct>;

export type TransactionScanValidation = Infer<
  typeof TransactionScanValidationStruct
>;
