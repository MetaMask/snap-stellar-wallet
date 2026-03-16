import type { KnownCaip2ChainId } from '../../api';

export class AccountNotFoundException extends Error {
  constructor(address: string, scope: KnownCaip2ChainId) {
    super(`Account not found for address: ${address} and scope: ${scope}`);
    this.name = 'AccountNotFoundException';
  }
}

export class DerivedAccountAddressMismatchException extends Error {
  constructor(address: string) {
    super(
      `Derived account address does not match the provided address: ${address}`,
    );
    this.name = 'DerivedAccountAddressMismatchException';
  }
}
