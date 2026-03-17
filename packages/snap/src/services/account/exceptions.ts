import type { KnownCaip2ChainId } from '../../api';

export class AccountNotFoundException extends Error {
  constructor(addressOrId: string, scope?: KnownCaip2ChainId) {
    super(
      `Account not found for address or id: ${addressOrId} and scope: ${scope}`,
    );
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

export class AccountRollbackException extends Error {
  constructor(accountId: string, address: string) {
    super(
      `Failed to rollback account creation for account ID: ${accountId} and address: ${address}`,
    );
    this.name = 'AccountRollbackException';
  }
}
