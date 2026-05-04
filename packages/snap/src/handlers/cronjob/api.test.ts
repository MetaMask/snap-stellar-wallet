import { assert, StructError } from '@metamask/superstruct';

import {
  BackgroundEventMethod,
  BackgroundEventMethodStruct,
  CronjobJsonRpcRequestStruct,
  RefreshConfirmationPricesJsonRpcRequestStruct,
  SyncAccountJsonRpcRequestStruct,
  SyncAccountParamsStruct,
  TrackTransactionJsonRpcRequestStruct,
} from './api';
import { KnownCaip2ChainId } from '../../api';
import { ConfirmationInterfaceKey } from '../../ui/confirmation/api';

describe('Cronjob API structs', () => {
  const jsonRpcBase = {
    jsonrpc: '2.0',
    id: 'request-id',
  } as const;

  describe('BackgroundEventMethodStruct', () => {
    it.each(Object.values(BackgroundEventMethod))(
      'accepts %s',
      (methodValue) => {
        expect(() =>
          assert(methodValue, BackgroundEventMethodStruct),
        ).not.toThrow();
      },
    );

    it('rejects unknown method values', () => {
      expect(() =>
        assert('unknownBackgroundMethod', BackgroundEventMethodStruct),
      ).toThrow(StructError);
    });
  });

  describe('SyncAccountParamsStruct', () => {
    it('accepts selected as accountIds value', () => {
      const value = { accountIds: 'selected' as const };
      assert(value, SyncAccountParamsStruct);
      expect(value).toStrictEqual({ accountIds: 'selected' });
    });

    it('accepts non-empty account id arrays', () => {
      const id = '4dd94666-52a0-4478-91f8-979292f91fae';
      const value = { accountIds: [id] };
      assert(value, SyncAccountParamsStruct);
      expect(value).toStrictEqual({ accountIds: [id] });
    });

    it('rejects empty account id arrays', () => {
      expect(() => assert({ accountIds: [] }, SyncAccountParamsStruct)).toThrow(
        StructError,
      );
    });

    it('rejects unknown properties', () => {
      expect(() =>
        assert(
          { accountIds: 'selected', extra: 'not-allowed' },
          SyncAccountParamsStruct,
        ),
      ).toThrow(StructError);
    });
  });

  describe('SyncAccountJsonRpcRequestStruct', () => {
    it('accepts synchronize accounts requests', () => {
      const value = {
        ...jsonRpcBase,
        method: BackgroundEventMethod.SynchronizeAccounts,
        params: { accountIds: 'selected' as const },
      };
      assert(value, SyncAccountJsonRpcRequestStruct);
      expect(value).toStrictEqual({
        ...jsonRpcBase,
        method: BackgroundEventMethod.SynchronizeAccounts,
        params: { accountIds: 'selected' },
      });
    });

    it('rejects wrong method for synchronize accounts request', () => {
      expect(() =>
        assert(
          {
            ...jsonRpcBase,
            method: BackgroundEventMethod.TrackTransaction,
            params: { accountIds: 'selected' },
          },
          SyncAccountJsonRpcRequestStruct,
        ),
      ).toThrow(StructError);
    });
  });

  describe('RefreshConfirmationPricesJsonRpcRequestStruct', () => {
    it('accepts refresh confirmation prices requests', () => {
      const value = {
        ...jsonRpcBase,
        method: BackgroundEventMethod.RefreshConfirmationPrices,
        params: {
          scope: KnownCaip2ChainId.Mainnet,
          interfaceId: 'interface-id',
          interfaceKey: ConfirmationInterfaceKey.SignTransaction,
        },
      };
      assert(value, RefreshConfirmationPricesJsonRpcRequestStruct);
      expect(value).toStrictEqual({
        ...jsonRpcBase,
        method: BackgroundEventMethod.RefreshConfirmationPrices,
        params: {
          scope: KnownCaip2ChainId.Mainnet,
          interfaceId: 'interface-id',
          interfaceKey: ConfirmationInterfaceKey.SignTransaction,
        },
      });
    });
  });

  describe('TrackTransactionJsonRpcRequestStruct', () => {
    it('accepts track transaction requests', () => {
      const value = {
        ...jsonRpcBase,
        method: BackgroundEventMethod.TrackTransaction,
        params: {
          txId: 'tx-id',
          scope: KnownCaip2ChainId.Mainnet,
          accountIds: ['4dd94666-52a0-4478-91f8-979292f91fae'],
        },
      };
      assert(value, TrackTransactionJsonRpcRequestStruct);
      expect(value).toStrictEqual({
        ...jsonRpcBase,
        method: BackgroundEventMethod.TrackTransaction,
        params: {
          txId: 'tx-id',
          scope: KnownCaip2ChainId.Mainnet,
          accountIds: ['4dd94666-52a0-4478-91f8-979292f91fae'],
        },
      });
    });

    it('rejects invalid accountIds values', () => {
      expect(() =>
        assert(
          {
            ...jsonRpcBase,
            method: BackgroundEventMethod.TrackTransaction,
            params: {
              txId: 'tx-id',
              scope: KnownCaip2ChainId.Mainnet,
              accountIds: ['invalid-uuid'],
            },
          },
          TrackTransactionJsonRpcRequestStruct,
        ),
      ).toThrow(StructError);
    });
  });

  describe('CronjobJsonRpcRequestStruct', () => {
    it('accepts successful cronjob responses', () => {
      const value = { status: true };
      assert(value, CronjobJsonRpcRequestStruct);
      expect(value).toStrictEqual({ status: true });
    });

    it('rejects non-boolean status values', () => {
      expect(() =>
        assert({ status: 'true' }, CronjobJsonRpcRequestStruct),
      ).toThrow(StructError);
    });
  });
});
