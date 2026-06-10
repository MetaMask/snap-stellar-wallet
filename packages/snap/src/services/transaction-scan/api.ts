/* eslint-disable @typescript-eslint/naming-convention */
import type { Infer } from '@metamask/superstruct';
import {
  array,
  boolean,
  enums,
  literal,
  nullable,
  number,
  optional,
  record,
  string,
  type,
  union,
  unknown,
} from '@metamask/superstruct';

import { KnownCaip2ChainId } from '../../api';

export enum TransactionScanOption {
  Simulation = 'simulation',
  Validation = 'validation',
}

export enum TransactionScanValidationType {
  Benign = 'Benign',
  Warning = 'Warning',
  Malicious = 'Malicious',
}

export enum TokenScanResultType {
  Malicious = 'Malicious',
  Warning = 'Warning',
  Benign = 'Benign',
  Trusted = 'Trusted',
  Verified = 'Verified',
  // eslint-disable-next-line @typescript-eslint/no-shadow
  Error = 'Error',
}

export type StellarSecurityAlertsChain = 'pubnet' | 'testnet' | 'futurenet';

export type TokenSecurityAlertsChain = 'stellar';

export type SecurityAlertsMetadata =
  | {
      type: 'wallet';
      url: string;
    }
  | {
      type: 'in_app';
    };

export type StellarTransactionScanRequest = {
  account_address: string;
  chain: StellarSecurityAlertsChain;
  metadata: SecurityAlertsMetadata;
  transaction: string;
  options?: TransactionScanOption[];
};

export type TokenScanRequest = {
  chain: TokenSecurityAlertsChain;
  address: string;
  metadata?: {
    domain: string;
  };
};

const TokenScanMetadataStruct = type({
  type: optional(string()),
  name: optional(string()),
  symbol: optional(string()),
  decimals: optional(number()),
});

export const ScanTokenResponseStruct = type({
  result_type: enums(Object.values(TokenScanResultType)),
  malicious_score: optional(number()),
  attack_types: optional(array(string())),
  chain: string(),
  address: string(),
  metadata: optional(TokenScanMetadataStruct),
  features: optional(array(unknown())),
});

export type ScanTokenResponse = Infer<typeof ScanTokenResponseStruct>;

const StellarAssetTransferDetailsStruct = type({
  raw_value: number(),
  value: number(),
  summary: optional(nullable(string())),
  usd_price: optional(nullable(number())),
});

const StellarAssetDetailsStruct = type({
  code: optional(string()),
  issuer: optional(string()),
  org_name: optional(string()),
  org_url: optional(string()),
  address: optional(string()),
  name: optional(string()),
  symbol: optional(string()),
  type: optional(string()),
});

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

export type TransactionScanStatus = 'SUCCESS' | 'ERROR';

export type TransactionScanAssetChange = {
  type: 'in' | 'out';
  value: number | null;
  price: number | null;
  symbol: string;
  name: string;
  logo: string | null;
};

export type TransactionScanEstimatedChanges = {
  assets: TransactionScanAssetChange[];
};

export type TransactionScanValidation = {
  type: TransactionScanValidationType | null;
  reason: string | null;
  description: string | null;
};

export type TransactionScanError = {
  type: string | null;
  code: string | null;
  message: string | null;
};

const TransactionScanAssetChangeStruct = type({
  type: enums(['in', 'out']),
  value: nullable(number()),
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
  type: nullable(string()),
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

export type TransactionScanResult = {
  status: TransactionScanStatus;
  estimatedChanges: TransactionScanEstimatedChanges;
  validation: TransactionScanValidation | null;
  error: TransactionScanError | null;
};

export type TokenScanResult = {
  resultType: TokenScanResultType;
  isMalicious: boolean;
  isWarning: boolean;
  name: string | null;
  symbol: string | null;
};

export const TokenScanResultStruct = type({
  resultType: enums(Object.values(TokenScanResultType)),
  isMalicious: boolean(),
  isWarning: boolean(),
  name: nullable(string()),
  symbol: nullable(string()),
});

export const SecurityScanRequestStruct = type({
  accountAddress: string(),
  origin: string(),
  scope: enums(Object.values(KnownCaip2ChainId)),
  transaction: string(),
});

export type SecurityScanRequest = {
  accountAddress: string;
  origin: string;
  scope: KnownCaip2ChainId;
  transaction: string;
};

export const TokenSecurityScanRequestStruct = type({
  assetReference: string(),
  origin: string(),
  scope: enums(Object.values(KnownCaip2ChainId)),
});

export type TokenSecurityScanRequest = {
  assetReference: string;
  origin: string;
  scope: KnownCaip2ChainId;
};
