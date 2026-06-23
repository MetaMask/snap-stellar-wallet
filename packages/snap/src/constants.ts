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
 */
export const NATIVE_ASSET_NAME = 'XLM';

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
export const MAX_INT64 = '9223372036854775807';

/**
 * The type for the keyring account.
 */
export const KEYRING_ACCOUNT_TYPE = XlmAccountType.Account;

/**
 * The origin for the MetaMask wallet.
 */
export const METAMASK_ORIGIN = 'metamask';

/**
 * The maximum page size for the transactions.
 *
 * @see https://developers.stellar.org/docs/data/apis/horizon/api-reference/get-transactions-by-account-id
 */
export const MAX_TRANSACTIONS_PAGE_SIZE = 200;

/**
 * Maximum number of pages remaining to fetch in this run.
 * This keeps scans responsive for high-activity accounts by avoiding full-history fetches at once.
 * Callers persist a Horizon paging token (from {@link Transaction.rawData}) between runs to continue incremental sync.
 *
 * @see {@link NetworkService.getTransactions}
 */
export const MAX_TRANSACTION_SCAN_PAGES = 2;

/*
 * The key for the memo required attribute.
 * It is used to check if the account requires a memo based on the SEP-0029 standard.
 *
 * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0029.md
 */
export const MEMO_REQUIRED_KEY = 'config.memo_required';

/**
 * ACCOUNT_REQUIRES_MEMO is the base64 encoding of "1".
 * SEP 29 uses this value to define transaction memo requirements for incoming payments.
 *
 * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0029.md
 */
export const ACCOUNT_REQUIRES_MEMO = 'MQ==';

/**
 * Maximum native XLM threshold for an incoming
 * payment to be treated as dust spam.
 *
 * Incoming native XLM payments at or below this value are omitted from activity
 * history. The threshold matches the 0.001 value used on TRON and Solana.
 */
export const DUST_XLM_AMOUNT = '0.001';
