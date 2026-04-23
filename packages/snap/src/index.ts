import type {
  OnUserInputHandler,
  OnKeyringRequestHandler,
  OnRpcRequestHandler,
  OnCronjobHandler,
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
  cronjobHandler,
  assetsHandler,
  sep43SignMessageHandler,
  sep43SignTransactionHandler,
} from './context';
import { Sep43Method } from './handlers/sep43';

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

export const onCronjob: OnCronjobHandler = async ({ request }) =>
  cronjobHandler.handle(request);

export const onRpcRequest: OnRpcRequestHandler = async ({ request }) => {
  const { method } = request;

  // SEP-43 dapp-facing methods. Both handlers always resolve to the SEP-43
  // response shape (success or error envelope) — they never throw to the dapp.
  // @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0043.md
  if (method === String(Sep43Method.SignMessage)) {
    return sep43SignMessageHandler.handle(request.params);
  }
  if (method === String(Sep43Method.SignTransaction)) {
    return sep43SignTransactionHandler.handle(request.params);
  }

  // TODO: deprecate the legacy `stellar_*` methods once dapps migrate to SEP-43.
  if (method === 'stellar_signMessage') {
    return signMessageHandler.handle(
      request.params as unknown as JsonRpcRequest,
    );
  }
  if (method === 'stellar_signTransaction') {
    return signTransactionHandler.handle(
      request.params as unknown as JsonRpcRequest,
    );
  }

  throw new MethodNotFoundError() as Error;
};
