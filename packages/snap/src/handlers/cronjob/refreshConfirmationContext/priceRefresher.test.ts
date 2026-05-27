import { createConfirmationDataContext } from './__fixtures__/context.fixtures';
import { ConfirmationPriceRefresher } from './priceRefresher';
import { KnownCaip2ChainId } from '../../../api';
import type { PriceService } from '../../../services/price';
import {
  type ContextWithPrices,
  FetchStatus,
} from '../../../ui/confirmation/api';
import { getSlip44AssetId } from '../../../utils';
import { logger } from '../../../utils/logger';

jest.mock('../../../utils/logger');

describe('ConfirmationPriceRefresher', () => {
  const scope = KnownCaip2ChainId.Testnet;
  const nativeAssetId = getSlip44AssetId(scope);

  function setup() {
    const getSpotPrices = jest.fn();
    const priceService = { getSpotPrices } as unknown as PriceService;
    const refresher = new ConfirmationPriceRefresher({
      logger,
      priceService,
    });
    return { refresher, getSpotPrices };
  }

  describe('shouldFetch', () => {
    it('returns false when tokenPrices is empty', () => {
      const { refresher } = setup();

      expect(
        refresher.shouldFetch(
          createConfirmationDataContext({
            tokenPrices: {} as ContextWithPrices['tokenPrices'],
          }),
        ),
      ).toBe(false);
    });

    it('returns false when status is Error', () => {
      const { refresher } = setup();

      expect(
        refresher.shouldFetch(
          createConfirmationDataContext({
            tokenPricesFetchStatus: FetchStatus.Error,
          }),
        ),
      ).toBe(false);
    });

    it('returns true when assets exist and status is not Error', () => {
      const { refresher } = setup();

      expect(refresher.shouldFetch(createConfirmationDataContext())).toBe(true);
    });
  });

  describe('recoveryResult', () => {
    it('returns null when status is not Fetching', () => {
      const { refresher } = setup();

      expect(
        refresher.recoveryResult(
          createConfirmationDataContext({
            tokenPricesFetchStatus: FetchStatus.Fetched,
          }),
        ),
      ).toBeNull();
    });

    it('clears Fetching to Fetched when fetch is skipped', () => {
      const { refresher } = setup();

      expect(
        refresher.recoveryResult(
          createConfirmationDataContext({
            tokenPricesFetchStatus: FetchStatus.Fetching,
          }),
        ),
      ).toStrictEqual({
        result: { tokenPricesFetchStatus: FetchStatus.Fetched },
        reschedule: false,
      });
    });
  });

  describe('refresh', () => {
    it('fetches spot prices and requests reschedule on success', async () => {
      const { refresher, getSpotPrices } = setup();
      getSpotPrices.mockResolvedValue({
        [nativeAssetId]: { price: 1.25 },
      });

      const result = await refresher.refresh(createConfirmationDataContext());

      expect(getSpotPrices).toHaveBeenCalledWith({
        assetIds: [nativeAssetId],
        vsCurrency: 'usd',
      });
      expect(result).toStrictEqual({
        result: {
          tokenPrices: { [nativeAssetId]: '1.25' },
          tokenPricesFetchStatus: FetchStatus.Fetched,
        },
        reschedule: true,
      });
    });

    it('returns error patch without reschedule when price fetch fails', async () => {
      const { refresher, getSpotPrices } = setup();
      getSpotPrices.mockRejectedValue(new Error('network error'));

      const result = await refresher.refresh(createConfirmationDataContext());

      expect(result).toStrictEqual({
        result: { tokenPricesFetchStatus: FetchStatus.Error },
        reschedule: false,
      });
    });
  });

  it('validates context with ContextWithPricesStruct', () => {
    const { refresher } = setup();

    expect(refresher.isValidContext(createConfirmationDataContext())).toBe(
      true,
    );
    expect(refresher.isValidContext({})).toBe(false);
  });
});
