/* eslint-disable @typescript-eslint/naming-convention */
import type { Infer } from '@metamask/superstruct';
import {
  array,
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

export type StellarSecurityAlertsChain = 'pubnet' | 'testnet' | 'futurenet';

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
  result_type: enums(['Benign', 'Warning', 'Malicious']),
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
  type: 'Benign' | 'Warning' | 'Malicious' | null;
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
  type: nullable(enums(['Benign', 'Warning', 'Malicious'])),
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
