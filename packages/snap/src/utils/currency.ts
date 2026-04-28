import { is } from '@metamask/superstruct';
import type { CaipAssetType } from '@metamask/utils';
import { parseCaipAssetType } from '@metamask/utils';
import { BigNumber } from 'bignumber.js';

import { FiatCaipAssetStruct } from '../api/asset';
import { STELLAR_DECIMAL_PLACES } from '../constants';

/**
 * Converts an amount to the smallest unit of the asset.
 *
 * @example toSmallestUnit(new BigNumber('12.3456789')) // 123456789 stroops
 *
 * @param amount - The amount to convert.
 * @param decimalPlaces - The number of decimal places to use.
 * @returns The amount in the smallest unit.
 */
export function toSmallestUnit(
  amount: BigNumber,
  decimalPlaces: number = STELLAR_DECIMAL_PLACES,
): BigNumber {
  return amount.multipliedBy(BigNumber(10).pow(decimalPlaces));
}

/**
 * Converts an amount from the smallest unit to a human-readable amount.
 *
 * @example normalizeAmount(new BigNumber(123456789)) // 12.3456789
 *
 * @param amount - Amount in stroops.
 * @param decimalPlaces - The number of decimal places to use.
 * @returns The amount in the human-readable format.
 */
export function normalizeAmount(
  amount: BigNumber,
  decimalPlaces: number = STELLAR_DECIMAL_PLACES,
): BigNumber {
  return amount.dividedBy(BigNumber(10).pow(decimalPlaces));
}

/**
 * Decimal string for keyring / MetaMask multichain balances.
 * {@link BigNumber#toString} may use scientific notation (e.g. `1e-7`); the extension's
 * `parseBalanceWithDecimals` only accepts `\d+(\.\d+)?`, so we use `toFixed` and trim
 * redundant trailing zeros.
 *
 * @param amountInSmallestUnit - Balance in the asset's smallest unit (e.g. stroops).
 * @param decimalPlaces - Asset decimals (e.g. 7 for XLM / classic Stellar assets).
 */
export function formatBalanceAmountForKeyringApi(
  amountInSmallestUnit: BigNumber,
  decimalPlaces: number,
): string {
  const fixed = normalizeAmount(amountInSmallestUnit, decimalPlaces).toFixed(
    decimalPlaces,
  );
  if (!fixed.includes('.')) {
    return fixed;
  }
  const trimmed = fixed.replace(/0+$/u, '').replace(/\.$/u, '');
  return trimmed === '' ? '0' : trimmed;
}

/**
 * Formats a number as currency (half-up rounded to 2 decimal places).
 *
 * @param amount - The amount of money.
 * @param currency - The currency to format the amount as.
 * @param locale - The locale to use for number formatting.
 * @returns The formatted currency string.
 * @throws {RangeError} If the amount is not a finite number.
 */
export function formatFiat(
  amount: string,
  currency: string,
  locale: string,
): string {
  const rounded = new BigNumber(amount).decimalPlaces(
    2,
    BigNumber.ROUND_HALF_UP,
  );

  if (!rounded.isFinite()) {
    throw new RangeError('Amount must be a finite number for fiat formatting');
  }

  const amountNumber = rounded.toNumber();
  const [localeCode] = locale.split('_');

  return amountNumber.toLocaleString(localeCode, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

/**
 * Converts a token amount to fiat currency using the provided conversion rate.
 *
 * @param tokenAmount - The amount of tokens to convert.
 * @param rateConversion - The conversion rate from token to fiat.
 * @returns The fiat value of the token amount.
 */
export function tokenToFiat(
  tokenAmount: string,
  rateConversion: string,
): string {
  const bigAmount = new BigNumber(tokenAmount);
  return bigAmount.multipliedBy(new BigNumber(rateConversion)).toString();
}

/**
 * Checks if a CAIP-19 asset type is a fiat asset.
 *
 * @param assetId - The CAIP-19 asset type.
 * @returns True if the asset is a fiat asset, false otherwise.
 */
export function isFiat(assetId: CaipAssetType): boolean {
  return is(assetId, FiatCaipAssetStruct);
}

/**
 * Extracts the ISO 4217 currency code (aka fiat ticker) from a fiat CAIP-19 asset ID.
 *
 * @param assetId - The CAIP-19 asset ID.
 * @returns The fiat ticker.
 */
export function getFiatTicker(assetId: CaipAssetType): string {
  if (!isFiat(assetId)) {
    throw new Error('Passed assetId is not a fiat asset');
  }

  const fiatTicker = parseCaipAssetType(assetId).assetReference.toLowerCase();

  return fiatTicker;
}
