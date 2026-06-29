import type {
  OnUserInputHandler,
  OnKeyringRequestHandler,
  OnAssetsConversionHandler,
  OnAssetHistoricalPriceHandler,
  OnAssetsLookupHandler,
  OnAssetsMarketDataHandler,
  OnClientRequestHandler,
  OnCronjobHandler,
} from '@metamask/snaps-sdk';

import {
  keyringHandler,
  userInputHandler,
  assetsHandler,
  clientRequestHandler,
  cronjobHandler,
} from './context';

export const onAssetHistoricalPrice: OnAssetHistoricalPriceHandler = async (
  args,
) => assetsHandler.onAssetHistoricalPrice(args);

export const onAssetsConversion: OnAssetsConversionHandler = async (args) =>
  assetsHandler.onAssetsConversion(args);

export const onAssetsLookup: OnAssetsLookupHandler = async (args) =>
  assetsHandler.onAssetsLookup(args);

export const onAssetsMarketData: OnAssetsMarketDataHandler = async (args) =>
  assetsHandler.onAssetsMarketData(args);

export const onKeyringRequest: OnKeyringRequestHandler = async ({
  origin,
  request,
}) => keyringHandler.handle(origin, request);

export const onUserInput: OnUserInputHandler = async (params) =>
  userInputHandler.handle(params);

export const onClientRequest: OnClientRequestHandler = async ({ request }) =>
  clientRequestHandler.handle(request);

export const onCronjob: OnCronjobHandler = async ({ request }) =>
  cronjobHandler.handle(request);
