import type { StellarSnapExceptionOptions } from '../../utils/errors';
import { StellarSnapException } from '../../utils/errors';

/** Base for all Security Alerts API client errors. */
export class TransactionScanException extends StellarSnapException {
  constructor(message: string, options?: StellarSnapExceptionOptions) {
    super(message, options);
    this.name = 'PriceServiceException';
  }
}
