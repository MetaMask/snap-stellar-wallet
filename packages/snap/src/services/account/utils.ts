import { DerivedAccountAddressMismatchException } from './exceptions';
import type { StellarAddress } from '../../api';
import { isSameStr } from '../../utils';

/**
 * Asserts two Stellar strkeys refer to the same account (case-insensitive).
 *
 * @param expectedAddress - Address treated as canonical for {@link DerivedAccountAddressMismatchException}.
 * @param actualAddress - Address to compare (e.g. derived or loaded from the network).
 * @throws {DerivedAccountAddressMismatchException} When the addresses differ.
 */
export function assertSameAddress(
  expectedAddress: StellarAddress,
  actualAddress: StellarAddress,
): void {
  if (!isSameStr(expectedAddress, actualAddress)) {
    throw new DerivedAccountAddressMismatchException(expectedAddress);
  }
}
