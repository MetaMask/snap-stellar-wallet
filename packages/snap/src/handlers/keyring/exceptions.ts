import {
  InvalidParamsError,
  UserRejectedRequestError,
} from '@metamask/snaps-sdk';
import { StructError } from '@metamask/superstruct';

import {
  AccountNotFoundException,
  DerivedAccountAddressMismatchException,
} from '../../services/account/exceptions';
import { NetworkServiceException } from '../../services/network/exceptions';
import {
  TransactionDeserializationException,
  TransactionValidationException,
} from '../../services/transaction/exceptions';
import { HttpException } from '../../utils';
import type { StellarSnapExceptionOptions } from '../../utils/errors';
import { StellarSnapException } from '../../utils/errors';

export class KeyringException extends StellarSnapException {}

/**
 * SEP-43 error codes.
 *
 * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0043.md
 */
export enum Sep43ErrorCode {
  /** Internal wallet error (JS runtime, programmer error, etc.). */
  Internal = -1,
  /** External service (Horizon, RPC, …) returned an error. */
  ExternalService = -2,
  /** Client app request is invalid (bad params, malformed XDR, unsupported option). */
  InvalidRequest = -3,
  /** User declined the confirmation. */
  UserRejected = -4,
}

/**
 * Generic SEP-43 message that's user-safe to forward to the dapp.
 *
 * Per-code default messages used when callers throw without a specific message.
 * The `ext` array carries optional richer context (e.g. underlying error message).
 */
export const SEP43_DEFAULT_MESSAGE: Record<Sep43ErrorCode, string> = {
  [Sep43ErrorCode.Internal]:
    'The wallet encountered an internal error. Please try again or contact the wallet if the problem persists.',
  [Sep43ErrorCode.ExternalService]:
    'An error occurred with an external service. Please try again.',
  [Sep43ErrorCode.InvalidRequest]:
    'Request is invalid. Please check the details and try again.',
  [Sep43ErrorCode.UserRejected]: 'The user rejected this request.',
};

/**
 * Structured SEP-43 error envelope returned to the dapp on failure.
 */
export class Sep43Error extends Error {
  readonly code: Sep43ErrorCode;

  readonly ext: string[] | undefined;

  constructor(params: {
    code: Sep43ErrorCode;
    message?: string;
    ext?: string[];
  }) {
    super(params.message ?? SEP43_DEFAULT_MESSAGE[params.code]);
    this.name = 'Sep43Error';
    this.code = params.code;
    this.ext = params.ext;
  }

  /**
   * Serializes to the SEP-43 `error` shape.
   *
   * @returns The serialized error payload (`message`, `code`, optional `ext`).
   */
  toJSON(): { message: string; code: number; ext?: string[] } {
    return {
      message: this.message,
      code: this.code,
      ...(this.ext === undefined ? {} : { ext: this.ext }),
    };
  }
}

/**
 * Maps any thrown error to a {@link Sep43Error}, classifying by known internal types.
 * Pass-through for `Sep43Error`; everything else falls back to {@link Sep43ErrorCode.Internal}.
 *
 * @param error - The thrown value.
 * @returns A {@link Sep43Error} ready to serialize back to the dapp.
 */
export function toSep43Error(error: unknown): Sep43Error {
  if (error instanceof Sep43Error) {
    return error;
  }

  if (error instanceof UserRejectedRequestError) {
    return new Sep43Error({ code: Sep43ErrorCode.UserRejected });
  }

  if (
    // `validateRequest` rewraps StructError as InvalidParamsError before it
    // reaches us, so we accept both shapes here.
    error instanceof InvalidParamsError ||
    error instanceof StructError ||
    // Catches AccountNotFoundException + DerivedAccountAddressMismatchException
    // (both extend AccountServiceException) — typically caused by a bad
    // `opts.address` from the dapp.
    error instanceof AccountNotFoundException ||
    error instanceof DerivedAccountAddressMismatchException ||
    error instanceof TransactionDeserializationException ||
    error instanceof TransactionValidationException
  ) {
    return new Sep43Error({
      code: Sep43ErrorCode.InvalidRequest,
      ext: [error.message],
    });
  }

  if (
    error instanceof NetworkServiceException ||
    error instanceof HttpException
  ) {
    return new Sep43Error({
      code: Sep43ErrorCode.ExternalService,
      ext: [error.message],
    });
  }

  return new Sep43Error({ code: Sep43ErrorCode.Internal });
}

export class KeyringAccountRollbackException extends KeyringException {
  constructor(accountId: string, options?: StellarSnapExceptionOptions) {
    super(
      `Failed to rollback account creation for account ${accountId}`,
      options,
    );
  }
}

export class KeyringEmitAccountCreatedEventException extends KeyringException {
  constructor(options?: StellarSnapExceptionOptions) {
    super('Failed to emit account created event', options);
  }
}

export class KeyringEmitAccountDeletedEventException extends KeyringException {
  constructor(options?: StellarSnapExceptionOptions) {
    super('Failed to emit account deleted event', options);
  }
}
