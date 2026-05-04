import {
  TransactionStatus,
  TransactionType,
  type Transaction as KeyringTransaction,
} from '@metamask/keyring-api';

import { KeyringTransactionBuilderException } from './exceptions';
import type { KnownCaip2ChainId } from '../../api';
import type { KnownCaip19AssetIdOrSlip44Id } from '../../api/asset';
import type { StellarKeyringAccount } from '../account/api';

export enum KeyringTransactionType {
  ChangeTrustOptIn = 'changeTrustOptIn',
  ChangeTrustOptOut = 'changeTrustOptOut',
  Send = 'send',
}

export type SendTransactionRequest = {
  txId: string;
  account: StellarKeyringAccount;
  scope: KnownCaip2ChainId;
  toAddress: string;
  amount: string;
  asset: {
    type: KnownCaip19AssetIdOrSlip44Id;
    symbol: string;
  };
  status?: TransactionStatus;
};

export type ChangeTrustTransactionRequest = {
  txId: string;
  account: StellarKeyringAccount;
  scope: KnownCaip2ChainId;
  asset: {
    type: KnownCaip19AssetIdOrSlip44Id;
    symbol: string;
  };
  status?: TransactionStatus;
};

export type KeyringTransactionRequest =
  | {
      type: KeyringTransactionType.ChangeTrustOptIn;
      request: ChangeTrustTransactionRequest;
    }
  | {
      type: KeyringTransactionType.ChangeTrustOptOut;
      request: ChangeTrustTransactionRequest;
    }
  | {
      type: KeyringTransactionType.Send;
      request: SendTransactionRequest;
    };

export class KeyringTransactionBuilder {
  createTransaction(request: KeyringTransactionRequest): KeyringTransaction {
    switch (request.type) {
      case KeyringTransactionType.ChangeTrustOptOut:
      case KeyringTransactionType.ChangeTrustOptIn:
        return this.#createChangeTrustTransaction(
          request.request,
          request.type,
        );
      case KeyringTransactionType.Send:
        return this.#createSendTransaction(request.request);
      default:
        throw new KeyringTransactionBuilderException(
          `Invalid transaction type`,
        );
    }
  }

  #createChangeTrustTransaction(
    request: ChangeTrustTransactionRequest,
    _type:
      | KeyringTransactionType.ChangeTrustOptIn
      | KeyringTransactionType.ChangeTrustOptOut,
  ): KeyringTransaction {
    const timestamp = this.#getCreateTime();
    const { txId, account, scope, asset } = request;

    return {
      // TODO: Add the correct type
      type: TransactionType.Unknown,
      id: txId,
      from: [
        {
          address: account.address,
          asset: {
            unit: asset.symbol,
            type: asset.type,
            amount: '0',
            fungible: true,
          },
        },
      ],
      to: [
        {
          address: account.address,
          asset: {
            unit: asset.symbol,
            type: asset.type,
            amount: '0',
            fungible: true,
          },
        },
      ],
      events: [
        {
          status: request.status ?? TransactionStatus.Unconfirmed,
          timestamp,
        },
      ],
      chain: scope,
      status: request.status ?? TransactionStatus.Unconfirmed,
      account: account.id,
      timestamp,
      fees: [],
    };
  }

  #createSendTransaction(request: SendTransactionRequest): KeyringTransaction {
    const timestamp = this.#getCreateTime();
    const { txId, account, scope, toAddress, amount, asset } = request;

    return {
      type: TransactionType.Send,
      id: txId,
      from: [
        {
          address: account.address,
          asset: {
            unit: asset.symbol,
            type: asset.type,
            amount,
            fungible: true,
          },
        },
      ],
      to: [
        {
          address: toAddress,
          asset: {
            unit: asset.symbol,
            type: asset.type,
            amount,
            fungible: true,
          },
        },
      ],
      events: [
        {
          status: TransactionStatus.Unconfirmed,
          timestamp,
        },
      ],
      chain: scope,
      status: TransactionStatus.Unconfirmed,
      account: account.id,
      timestamp,
      fees: [],
    };
  }

  #getCreateTime(): number {
    return Math.floor(Date.now() / 1000); // seconds since epoch
  }
}
