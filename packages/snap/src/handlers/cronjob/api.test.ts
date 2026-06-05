import { assert, StructError } from '@metamask/superstruct';

import {
  BackgroundEventMethod,
  BackgroundEventMethodStruct,
  CronjobJsonRpcRequestStruct,
  RefreshConfirmationContextJsonRpcRequestStruct,
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

    it('accepts empty object when accountIds is omitted', () => {
      const value = {};
      assert(value, SyncAccountParamsStruct);
      expect(value).toStrictEqual({});
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

    it('accepts synchronize accounts requests without params for declarative cron', () => {
      const value = {
        ...jsonRpcBase,
        method: BackgroundEventMethod.SynchronizeAccounts,
      };
      assert(value, SyncAccountJsonRpcRequestStruct);
      expect(value).toStrictEqual({
        ...jsonRpcBase,
        method: BackgroundEventMethod.SynchronizeAccounts,
      });
    });

    it('accepts synchronize accounts requests with empty params object', () => {
      const value = {
        ...jsonRpcBase,
        method: BackgroundEventMethod.SynchronizeAccounts,
        params: {},
      };
      assert(value, SyncAccountJsonRpcRequestStruct);
      expect(value).toStrictEqual({
        ...jsonRpcBase,
        method: BackgroundEventMethod.SynchronizeAccounts,
        params: {},
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

  describe('RefreshConfirmationContextJsonRpcRequestStruct', () => {
    it('accepts refresh confirmation context requests', () => {
      const value = {
        ...jsonRpcBase,
        method: BackgroundEventMethod.RefreshConfirmationContext,
        params: {
          scope: KnownCaip2ChainId.Mainnet,
          interfaceId: 'interface-id',
          interfaceKey: ConfirmationInterfaceKey.SignTransaction,
          refresherKeys: ['prices'],
        },
      };
      assert(value, RefreshConfirmationContextJsonRpcRequestStruct);
      expect(value).toStrictEqual({
        ...jsonRpcBase,
        method: BackgroundEventMethod.RefreshConfirmationContext,
        params: {
          scope: KnownCaip2ChainId.Mainnet,
          interfaceId: 'interface-id',
          interfaceKey: ConfirmationInterfaceKey.SignTransaction,
          refresherKeys: ['prices'],
        },
      });
    });
  });

  describe('TrackTransactionJsonRpcRequestStruct', () => {
    const txId =
      '7d4b0c5ef7498b223f45a10f461060fb64f53eb13caf18e8dc7de95a8cf9c0e1';
    const senderAccountId = '4dd94666-52a0-4478-91f8-979292f91fae';
    const receiverAddress =
      'GDTF7ERUQVTX23ZD6NY5XRYC5IQAKWFVTQ6IXSMEZWGVNDDGPYCVHRZP';

    it('accepts track transaction requests', () => {
      const value = {
        ...jsonRpcBase,
        method: BackgroundEventMethod.TrackTransaction,
        params: {
          txId,
          scope: KnownCaip2ChainId.Mainnet,
          accountIdsOrAddresses: [senderAccountId],
        },
      };
      assert(value, TrackTransactionJsonRpcRequestStruct);
      expect(value).toStrictEqual({
        ...jsonRpcBase,
        method: BackgroundEventMethod.TrackTransaction,
        params: {
          txId,
          scope: KnownCaip2ChainId.Mainnet,
          accountIdsOrAddresses: [senderAccountId],
        },
      });
    });

    it('accepts sender and receiver address in accountIdsOrAddresses', () => {
      const value = {
        ...jsonRpcBase,
        method: BackgroundEventMethod.TrackTransaction,
        params: {
          txId,
          scope: KnownCaip2ChainId.Mainnet,
          accountIdsOrAddresses: [senderAccountId, receiverAddress],
        },
      };
      assert(value, TrackTransactionJsonRpcRequestStruct);
      expect(value.params.accountIdsOrAddresses).toStrictEqual([
        senderAccountId,
        receiverAddress,
      ]);
    });

    it('rejects invalid accountIdsOrAddresses values', () => {
      expect(() =>
        assert(
          {
            ...jsonRpcBase,
            method: BackgroundEventMethod.TrackTransaction,
            params: {
              txId,
              scope: KnownCaip2ChainId.Mainnet,
              accountIdsOrAddresses: ['invalid-uuid'],
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
