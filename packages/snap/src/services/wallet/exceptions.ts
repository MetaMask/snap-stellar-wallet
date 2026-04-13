/** Base for {@link WalletService} errors (currently keypair derivation from entropy). */
export class WalletServiceException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WalletServiceException';
  }
}

/**
 * Thrown when the transaction cannot be signed.
 */
export class SignTransactionException extends Error {
  constructor() {
    super('Failed to sign transaction');
    this.name = 'SignTransactionException';
  }
}

/**
 * Thrown when the message cannot be signed.
 */
export class SignMessageException extends Error {
  constructor() {
    super('Failed to sign message');
    this.name = 'SignMessageException';
  }
}

/**
 * Thrown when the message cannot be verified.
 */
export class VerifyMessageException extends Error {
  constructor() {
    super('Failed to verify message');
    this.name = 'VerifyMessageException';
  }
}
