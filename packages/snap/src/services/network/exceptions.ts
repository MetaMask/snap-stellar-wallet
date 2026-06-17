import type { KnownCaip2ChainId } from '../../api';
import {
  StellarSnapException,
  type StellarSnapExceptionOptions,
} from '../../exceptions/base';

/** Base for all network-related errors (fees, account load, send, poll). */
export class NetworkServiceException extends StellarSnapException {}

/** Thrown when transaction polling does not result in SUCCESS (e.g. failed or unknown status). */
export class TransactionPollException extends NetworkServiceException {
  readonly transactionHash: string;

  readonly status: string;

  readonly scope: KnownCaip2ChainId;

  constructor(
    transactionHash: string,
    status: string,
    scope: KnownCaip2ChainId,
    options?: StellarSnapExceptionOptions,
  ) {
    super(
      `Failed to poll transaction: ${transactionHash} with status: ${status} for scope: ${scope}`,
      options,
    );
    this.transactionHash = transactionHash;
    this.status = status;
    this.scope = scope;
  }
}

/** Thrown when the account does not exist or is not funded on the network. */
export class AccountNotActivatedException extends NetworkServiceException {
  readonly address: string;

  readonly scope: KnownCaip2ChainId;

  constructor(
    address: string,
    scope: KnownCaip2ChainId,
    options?: StellarSnapExceptionOptions,
  ) {
    super(
      `Account not activated for address: ${address} for scope: ${scope}`,
      options,
    );
    this.address = address;
    this.scope = scope;
  }
}

/** Thrown when transaction submission to the network fails. */
export class TransactionSendException extends NetworkServiceException {
  readonly reference?: string;

  constructor(
    scope: KnownCaip2ChainId,
    reference?: string,
    options?: StellarSnapExceptionOptions,
  ) {
    super(
      `Failed to send transaction: scope: ${scope} ${reference ? ` reference: ${reference}` : ''}`,
      options,
    );
    this.reference = reference;
  }
}

/** Submit failed with a code the caller may recover from by fixing sequence and retrying (e.g. `txBadSeq`). */
export class TransactionRetryableException extends TransactionSendException {}

/** Thrown when a transaction is not found. */
export class TransactionNotFoundException extends NetworkServiceException {
  constructor(transactionHash: string, options?: StellarSnapExceptionOptions) {
    super(`Transaction ${transactionHash} not found`, options);
  }
}

/** Thrown when a transaction simulation fails. */
export class SimulationException extends NetworkServiceException {
  constructor(message: string, options?: StellarSnapExceptionOptions) {
    super(`Failed to simulate transaction: ${message}`, options);
  }
}
