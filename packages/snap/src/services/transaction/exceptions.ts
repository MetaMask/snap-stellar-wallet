import type {
  KnownCaip19AssetIdOrSlip44Id,
  KnownCaip2ChainId,
} from '../../api';

/** Thrown when building or rebuilding a transaction fails (e.g. invalid asset or SDK error). */
export class TransactionBuilderException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransactionBuilderException';
  }
}

/** Base for all transaction validation errors (simulation, trustlines, balances). */
export class TransactionValidationException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransactionValidationException';
  }
}

/**
 * Thrown when a caller-supplied CAIP-2 scope does not match the transaction envelope's network.
 */
export class TransactionScopeNotMatchException extends TransactionValidationException {
  readonly expectedScope: KnownCaip2ChainId;

  readonly transactionScope: KnownCaip2ChainId;

  constructor(
    expectedScope: KnownCaip2ChainId,
    transactionScope: KnownCaip2ChainId,
  ) {
    super(
      `Transaction scope ${transactionScope} does not match expected scope ${expectedScope}`,
    );
    this.name = 'TransactionScopeNotMatchException';
    this.expectedScope = expectedScope;
    this.transactionScope = transactionScope;
  }
}

export class UnsupportedOperationTypeException extends TransactionValidationException {
  constructor(operationType: string) {
    super(`Unsupported operation type: ${operationType}`);
  }
}

/** Thrown when creating an account with a non-native asset is not supported. */
export class InvalidAssetForCreateAccountException extends TransactionValidationException {
  constructor(assetId: string) {
    super(`Create account with non-native asset ${assetId} is not supported`);
  }
}

export class InvalidAssetForSep41TransferException extends TransactionValidationException {
  constructor(assetId: string) {
    super(`Transfer with SEP-41 asset ${assetId} is not supported`);
  }
}

/**
 * Thrown when `Operation.createAccount` starting balance is below 1 XLM (no sponsorship modeled).
 */
export class InvalidAmountForCreateAccountException extends TransactionValidationException {
  constructor(amount: string) {
    super(
      `Invalid amount for create account: ${amount} — minimum starting balance is 1 XLM`,
    );
  }
}

/** Thrown when the trustline is not found. */
/**
 * Thrown when a payment uses a trustline that exists but is not authorized (`is_authorized` false).
 */
export class TrustlineNotAuthorizedException extends TransactionValidationException {
  readonly assetId: KnownCaip19AssetIdOrSlip44Id;

  readonly accountAddress: string;

  constructor(assetId: KnownCaip19AssetIdOrSlip44Id, accountAddress: string) {
    super(
      `Trustline for asset ${assetId} on account ${accountAddress} is not authorized`,
    );
    this.assetId = assetId;
    this.accountAddress = accountAddress;
  }
}

export class TrustlineNotFoundException extends TransactionValidationException {
  /** CAIP-19 asset id (or slip44 id for native) for the missing trustline. */
  readonly assetId: KnownCaip19AssetIdOrSlip44Id;

  /** Stellar account address (G…) that lacks the trustline. */
  readonly accountAddress: string;

  /**
   * @param assetId - CAIP-19 (or slip44) id of the asset.
   * @param accountAddress - Account public key missing the trustline.
   */
  constructor(assetId: KnownCaip19AssetIdOrSlip44Id, accountAddress: string) {
    super(
      `Trustline not found for asset ${assetId} on account ${accountAddress}`,
    );
    this.assetId = assetId;
    this.accountAddress = accountAddress;
  }
}

/** Thrown when the trustline already exists. */
export class TrustlineAlreadyExistsException extends TransactionValidationException {
  readonly assetId: KnownCaip19AssetIdOrSlip44Id;

  constructor(assetId: KnownCaip19AssetIdOrSlip44Id) {
    super(`Trustline already exists for asset: ${assetId}`);
    this.assetId = assetId;
  }
}

/** Thrown when the trustline structure is invalid. */
export class InvalidTrustlineException extends TransactionValidationException {
  constructor(message: string) {
    super(`Invalid trustline: ${message}`);
  }
}

/** Thrown when the trustline removal fails. */
export class RemoveTrustlineWithNonZeroBalanceException extends TransactionValidationException {
  constructor(message: string) {
    super(`Failed to remove the trustline: ${message}`);
  }
}

/** Thrown when the trustline update fails. */
export class UpdateTrustlineException extends TransactionValidationException {
  constructor(message: string) {
    super(`Failed to update the trustline: ${message}`);
  }
}

/**
 * Thrown when the account's spendable native (XLM) balance is below what the transaction requires
 * for fees, reserves, and native outflows (all in stroops).
 */
export class InsufficientBalanceToCoverFeeException extends TransactionValidationException {
  constructor(balance: string, required: string) {
    super(
      `Insufficient native balance for transaction: ${balance} stroops available is less than ${required} stroops required`,
    );
  }
}

export class InsufficientBalanceToCoverBaseReserveException extends TransactionValidationException {
  constructor(balance: string, required: string) {
    super(
      `Insufficient native balance for transaction for base reserve: ${balance} stroops available is less than ${required} stroops required`,
    );
  }
}
/**
 * Thrown when the account's spendable balance for a non-native asset is below the amount required
 * by the transaction (amounts in the asset's smallest units).
 */
export class InsufficientBalanceException extends TransactionValidationException {
  constructor(balance: string, required: string) {
    super(
      `Insufficient asset balance for transaction: ${balance} available is less than ${required} required`,
    );
  }
}

/**
 * Thrown when the invoke host function transaction has more than one operation.
 */
export class InvalidInvokeContractStructureException extends TransactionValidationException {
  constructor() {
    super(`Invoke host function transaction must have exactly one operation`);
  }
}
