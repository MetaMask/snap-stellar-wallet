import type { StellarSnapExceptionOptions } from '../../utils';
import { StellarSnapException } from '../../utils';

export class AccountServiceException extends StellarSnapException {}

export class AccountNotFoundException extends AccountServiceException {
  constructor(addressOrId: string, options?: StellarSnapExceptionOptions) {
    super(`Account not found for address or id: ${addressOrId}`, options);
  }
}

export class DerivedAccountAddressMismatchException extends AccountServiceException {
  constructor(address: string, options?: StellarSnapExceptionOptions) {
    super(
      `Derived account address does not match the provided address: ${address}`,
      options,
    );
  }
}
