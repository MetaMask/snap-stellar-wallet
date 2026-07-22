import { KnownCaip2ChainId } from '../../../../api';
import {
  ConfirmationInterfaceKey,
  FetchStatus,
} from '../../../../ui/confirmation/api';
import type { ContextWithPrices } from '../../../../ui/confirmation/api';
import { getSlip44AssetId } from '../../../../utils';
import type { RefreshConfirmationContextParams } from '../../api';
import { ConfirmationContextRefresherKey } from '../api';
import type { ConfirmationDataContext } from '../api';

const scope = KnownCaip2ChainId.Testnet;
const nativeAssetId = getSlip44AssetId(scope);

export const confirmationContextRequestParams: RefreshConfirmationContextParams =
  {
    scope,
    interfaceId: 'interface-id-1',
    interfaceKey: ConfirmationInterfaceKey.SignTransaction,
    refresherKeys: [ConfirmationContextRefresherKey.Prices],
  };

/**
 * Builds a valid confirmation refresh context for tests.
 *
 * @param overrides - Partial fields to override on the default context.
 * @returns A context that satisfies {@link ContextWithPricesStruct}.
 */
export function createConfirmationDataContext(
  overrides: Partial<ConfirmationDataContext> = {},
): ConfirmationDataContext {
  return {
    tokenPrices: {
      [nativeAssetId]: null,
    } as ContextWithPrices['tokenPrices'],
    tokenPricesFetchStatus: FetchStatus.Fetching,
    currency: 'usd',
    preferences: { useExternalPricingData: true },
    ...overrides,
  };
}
