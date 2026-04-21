import type {
  OnUserInputHandler,
  OnKeyringRequestHandler,
  OnRpcRequestHandler,
  OnAssetHistoricalPriceHandler,
  OnAssetsConversionHandler,
  OnAssetsLookupHandler,
  OnAssetsMarketDataHandler,
} from '@metamask/snaps-sdk';
import { MethodNotFoundError } from '@metamask/snaps-sdk';
import type { JsonRpcRequest } from '@metamask/utils';

import {
  keyringHandler,
  signMessageHandler,
  userInputHandler,
  signTransactionHandler,
  assetsHandler,
} from './context';

// random change

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

export const onRpcRequest: OnRpcRequestHandler = async ({ request }) => {
  const { method } = request;

  switch (method) {
    case 'stellar_signMessage':
      return signMessageHandler.handle(
        request.params as unknown as JsonRpcRequest,
      );
    case 'stellar_signTransaction':
      return signTransactionHandler.handle(
        request.params as unknown as JsonRpcRequest,
      );
    default:
      throw new MethodNotFoundError() as Error;
  }
};
