export type StellarSnapExceptionOptions = {
  cause?: unknown;
  data?: Record<string, unknown>;
};

/**
 * Walks an error's `cause` chain to the original thrown value.
 *
 * @param error - Error to walk from.
 * @returns The deepest `Error` in the chain, or the terminal non-`Error` cause.
 */
function getRootCause(error: Error): unknown {
  let deepest: Error = error;
  while (deepest.cause instanceof Error) {
    deepest = deepest.cause;
  }
  return deepest.cause ?? deepest;
}

export class StellarSnapException extends Error {
  readonly data?: Record<string, unknown>;

  constructor(message: string, options?: StellarSnapExceptionOptions) {
    super(message, { cause: options?.cause });
    this.name = new.target.name;
    this.data = options?.data;
  }

  /**
   * Walk cause chain to the original thrown value.
   *
   * @returns The deepest `Error` in the chain, or the terminal non-`Error` cause.
   */
  get rootCause(): unknown {
    return getRootCause(this);
  }
}

/**
 * @param error - Value from a `catch` clause.
 * @returns Whether `error` is a {@link StellarSnapException} (including subclasses).
 */
export function isStellarSnapException(
  error: unknown,
): error is StellarSnapException {
  return error instanceof StellarSnapException;
}
