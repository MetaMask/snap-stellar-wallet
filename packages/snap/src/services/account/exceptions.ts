export class AccountServiceException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountServiceException';
  }
}

export class AccountNotFoundException extends AccountServiceException {
  constructor(addressOrId: string) {
    super(`Account not found for address or id: ${addressOrId}`);
    this.name = 'AccountNotFoundException';
  }
}

export class DerivedAccountAddressMismatchException extends AccountServiceException {
  constructor(address: string) {
    super(
      `Derived account address does not match the provided address: ${address}`,
    );
    this.name = 'DerivedAccountAddressMismatchException';
  }
}

export class AccountRollbackException extends AccountServiceException {
  constructor(accountId: string, address: string) {
    super(
      `Failed to rollback account creation for account ID: ${accountId} and address: ${address}`,
    );
    this.name = 'AccountRollbackException';
  }
}
