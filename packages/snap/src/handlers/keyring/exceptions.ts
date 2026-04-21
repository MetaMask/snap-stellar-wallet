import type { ResolveAccountAddressJsonRpcRequest } from './api';
import type { KnownCaip2ChainId } from '../../api/network';

export class KeyringException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyringException';
  }
}

export class KeyringListAccountsException extends KeyringException {
  constructor() {
    super(`Failed to list accounts`);
  }
}

export class KeyringGetAccountException extends KeyringException {
  constructor(accountId: string) {
    super(`Failed to get account for account ${accountId}`);
  }
}

export class KeyringCreateAccountException extends KeyringException {
  constructor() {
    super('Failed to create account');
  }
}

export class KeyringListAccountAssetsException extends KeyringException {
  constructor(accountId: string) {
    super(`Failed to list account assets for account ${accountId}`);
  }
}

export class KeyringListAccountTransactionsException extends KeyringException {
  constructor(accountId: string, message?: string) {
    super(
      `Failed to list account transactions for account ${accountId}${message ? `: ${message}` : ''}`,
    );
  }
}

export class KeyringDiscoverAccountsException extends KeyringException {
  constructor() {
    super('Failed to discover accounts');
  }
}

export class KeyringGetAccountBalancesException extends KeyringException {
  constructor(accountId: string) {
    super(`Failed to get account balances for account ${accountId}`);
  }
}

export class KeyringResolveAccountAddressException extends KeyringException {
  constructor(
    scope: KnownCaip2ChainId,
    request: ResolveAccountAddressJsonRpcRequest,
  ) {
    super(
      `Failed to resolve account address for scope ${scope} and address ${request.params.address}`,
    );
  }
}

export class KeyringDeleteAccountException extends KeyringException {
  constructor(accountId: string) {
    super(`Failed to delete account for account ${accountId}`);
  }
}

export class KeyringEmitAccountCreatedEventException extends KeyringException {
  constructor() {
    super('Failed to emit account created event');
  }
}
