import { StellarSnapException } from '../../utils/errors';

/** Base for wallet-layer errors (derivation, signing, verification, export). */
export class WalletServiceException extends StellarSnapException {}

/**
 * Thrown when keypair derivation from entropy fails. Messages describe the failing
 * step without exposing sensitive Snap RPC details.
 */
export class KeyDerivationException extends WalletServiceException {
  constructor(message?: string) {
    super(`Key derivation failed.${message ? ` ${message}` : ''}`);
  }
}

/**
 * Thrown when the transaction cannot be signed.
 */
export class SignTransactionException extends WalletServiceException {
  constructor() {
    super('Failed to sign transaction');
  }
}

/**
 * Thrown when the message cannot be signed.
 */
export class SignMessageException extends WalletServiceException {
  constructor() {
    super('Failed to sign message');
  }
}

/**
 * Thrown when the SEP-43 auth entry cannot be signed.
 */
export class SignAuthEntryException extends WalletServiceException {
  constructor() {
    super('Failed to sign auth entry');
  }
}

/**
 * Thrown when the message cannot be verified.
 */
export class VerifyMessageException extends WalletServiceException {
  constructor() {
    super('Failed to verify message');
  }
}

/**
 * Thrown when the private key cannot be exported.
 */
export class ExportKeyException extends WalletServiceException {
  constructor() {
    super('Failed to export key');
  }
}
