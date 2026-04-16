import { XlmAccountType } from '@metamask/keyring-api';

/**
 * The base reserve for the Stellar network.
 *
 * @see https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts
 */
export const XLM_PER_BASE_RESERVE = 0.5;

/** Stellar native amounts use 7 fractional digits (stroops per whole XLM). */
export const STROOPS_PER_XLM = 10_000_000;

/**
 * One base reserve in stroops (`XLM_PER_BASE_RESERVE` × 10^7; Stellar uses 7 decimal places).
 */
export const BASE_RESERVE_STROOPS = XLM_PER_BASE_RESERVE * STROOPS_PER_XLM;

/**
 * Stellar's coin type
 *
 * @see https://github.com/satoshilabs/slips/blob/master/slip-0044.md
 */
export const STELLAR_COIN_TYPE = 148;

/**
 * Stellar curve type.
 *
 * @see https://developers.stellar.org/docs/learn/fundamentals/transactions/signatures-multisig
 */
export const STELLAR_CURVE = 'ed25519';

/** Stellar BIP32 derivation path prefix. */
export const STELLAR_DERIVATION_PATH_PREFIX = `m/44'/${STELLAR_COIN_TYPE}'`;

/**
 * The number of decimal places for the native asset of Stellar.
 * All assets (except custom assets) on the Stellar network use exactly 7 decimal places of precision - this is a hard-coded limit at the protocol level
 *
 * @see https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/assets
 */
export const STELLAR_DECIMAL_PLACES = 7;

/**
 * The symbol for the native asset of Stellar.
 */
export const NATIVE_ASSET_SYMBOL = 'XLM';

/**
 * The name for the native asset of Stellar.
 *
 * @see https://stellar.org/learn/lumens
 */
export const NATIVE_ASSET_NAME = 'Lumen';

/**
 * The minimum base fee in stroops for the Stellar network.
 *
 * @see https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering
 */
export const BASE_FEE = 100;

/**
 * The maximum int64 balance for the Stellar network.
 *
 * @see https://stellar.org/learn/lumens
 */
export const MAX_INT64_BALANCE = '9223372036854775807';

/**
 * The type for the keyring account.
 */
export const KEYRING_ACCOUNT_TYPE = XlmAccountType.Account;
