import type { KnownCaip2ChainId } from '../../api';

/** Base for all network-related errors (fees, account load, send, poll). */
export class NetworkServiceException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkServiceException';
  }
}

/** Thrown when the base fee cannot be fetched from the network (e.g. Horizon unreachable). */
export class BaseFeeFetchException extends NetworkServiceException {
  constructor(scope: KnownCaip2ChainId) {
    super(`Failed to fetch base fee for scope: ${scope}`);
  }
}

/** Thrown when transaction polling does not result in SUCCESS (e.g. failed or unknown status). */
export class TransactionPollException extends NetworkServiceException {
  constructor(
    transactionHash: string,
    status: string,
    scope: KnownCaip2ChainId,
  ) {
    super(
      `Failed to poll transaction: ${transactionHash} with status: ${status} for scope: ${scope}`,
    );
  }
}

/** Thrown when account data cannot be loaded (e.g. network error; not used for "account not found"). */
export class AccountLoadException extends NetworkServiceException {
  constructor(accountAddress: string, scope: KnownCaip2ChainId) {
    super(`Failed to load account: ${accountAddress} for scope: ${scope}`);
  }
}

/** Thrown when the account does not exist or is not funded on the network. */
export class AccountNotActivatedException extends NetworkServiceException {
  constructor(address: string, scope: KnownCaip2ChainId) {
    super(`Account not activated for address: ${address} for scope: ${scope}`);
  }
}

/** Thrown when transaction submission to the network fails. */
export class TransactionSendException extends NetworkServiceException {
  constructor(scope: KnownCaip2ChainId) {
    super(`Failed to send transaction: scope: ${scope}`);
  }
}

/** Base for wallet service errors (derivation, signing). */
export class WalletServiceException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WalletServiceException';
  }
}

/** Thrown when building or rebuilding a transaction fails (e.g. invalid asset or SDK error). */
export class TransactionBuilderException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransactionBuilderException';
  }
}
