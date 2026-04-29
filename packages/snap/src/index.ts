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
import type { Json } from '@metamask/utils';

import {
  keyringHandler,
  userInputHandler,
  cronjobHandler,
  assetsHandler,
  signMessageHandler,
  signTransactionHandler,
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

export const onCronjob: OnCronjobHandler = async ({ request }) =>
  cronjobHandler.handle(request);

/**
 * Dev-only RPC entry point.
 *
 * The production sign path goes through the multichain CAIP-25 API
 * (`wallet_invokeMethod`) which routes to `onKeyringRequest` →
 * `KeyringHandler.submitRequest` → the same SEP-43-shaped handlers below.
 *
 * `endowment:rpc` is added to the manifest only by `scripts/update-manifest-local.js`
 * in the `local` / `test` environments, and stripped for `production`. As a result
 * this entry point is inert in production: the snap framework refuses to route
 * RPC traffic without the endowment.
 *
 * The `stellar_*` aliases exist purely so the local test dapp at
 * `http://localhost:3000` can exercise the SEP-43 sign flow via
 * `wallet_invokeSnap`, without having to bundle `@metamask/multichain-api-client`
 * just to run the dev loop. The forwarded payload is the same SEP-43 keyring
 * request shape; the response is the same SEP-43 envelope.
 *
 * **Reachability (for reviewers):** production flows use
 * `wallet_invokeMethod` / the multichain stack so MetaMask routes
 * `keyring_submitRequest` with an internal caller origin. Arbitrary dapp
 * origins cannot invoke `keyring_submitRequest` from the page (MetaMask
 * hard-restricts that in the extension). The dev aliases below are the
 * supported way to hit the same handlers from a localhost dapp; production
 * snaps built without `endowment:rpc` never expose `onRpcRequest` to the network.
 *
 * @param args - The RPC request from MetaMask.
 * @param args.request - The JSON-RPC request payload.
 * @returns The SEP-43 response envelope produced by the matching handler.
 */
export const onRpcRequest: OnRpcRequestHandler = async ({ request }) => {
  switch (request.method) {
    case 'stellar_signMessage':
      return signMessageHandler.handle(request.params as Json);
    case 'stellar_signTransaction':
      return signTransactionHandler.handle(request.params as Json);
    default:
      throw new MethodNotFoundError() as Error;
  }
};
