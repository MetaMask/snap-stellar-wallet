import { defaultSnapOrigin } from '../config';
import { useRequest } from './useRequest';

export type InvokeKeyringParams = {
  method: string;
  params?: Record<string, unknown>;
};

/**
 * Wraps `wallet_invokeKeyring` for the Stellar wallet snap keyring.
 *
 * @param snapId - Snap ID. Defaults to {@link defaultSnapOrigin}.
 * @returns Function that invokes the given keyring JSON-RPC method.
 */
export const useInvokeKeyring = (snapId = defaultSnapOrigin) => {
  const request = useRequest();

  const invokeKeyring = async ({ method, params }: InvokeKeyringParams) =>
    request({
      method: 'wallet_invokeKeyring',
      params: {
        snapId,
        request: {
          method,
          params,
        },
      },
    });

  return invokeKeyring;
};
