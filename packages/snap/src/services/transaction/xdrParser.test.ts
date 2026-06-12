import type { Operation, xdr } from '@stellar/stellar-sdk';
import { Asset } from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import {
  swapTransactionPathReceiveResponse,
  swapTransactionWithFeeCollectResponse,
  swapTransactionWithoutFeeCollectResponse,
} from './__mocks__/horizon-transaction-responses.fixtures';
import {
  buildMockInvokeHostFunctionTransaction,
  type MockInvokeHostFunctionArgNativeToScValOptions,
} from './__mocks__/transaction.fixtures';
import { XdrParseException } from './exceptions';
import {
  isSep41TransferInvoke,
  parseSep41TransferInvoke,
  parseSep41TransferInvokeSafe,
  parseSuccessfulTransactionResult,
  TransactionResultType,
  xdrAssetToCaip19,
} from './xdrParser';
import { KnownCaip2ChainId } from '../../api';
import {
  getSlip44AssetId,
  toCaip19ClassicAssetId,
  toCaip19Sep41AssetId,
} from '../../utils';
import { caip2ChainIdToNetwork } from '../network/utils';

describe('transaction-xdr-decoder', () => {
  const scope = KnownCaip2ChainId.Mainnet;
  const accountAddress =
    'GA7UCNSASSOPQYTRGJ2NC7TDBSXHMWK6JHS7AO6X2ZQAIQSTB5ELNFSO';
  const usdcIssuer = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

  describe('parseSuccessfulTransactionResult', () => {
    it('returns null for invalid xdr', () => {
      expect(
        parseSuccessfulTransactionResult('not-valid-xdr', scope),
      ).toBeNull();
    });

    it('parses pathPaymentStrictSendSuccess from single-op swap', () => {
      const result = parseSuccessfulTransactionResult(
        swapTransactionWithoutFeeCollectResponse.result_xdr,
        scope,
      );

      expect(result).toStrictEqual({
        feeCharged: '100',
        operationResults: [
          {
            type: TransactionResultType.PathPaymentStrictSendSuccess,
            amount: '0.1579988',
            destination: accountAddress,
            asset: toCaip19ClassicAssetId(scope, 'USDC', usdcIssuer),
          },
        ],
      });
    });

    it('parses pathPaymentStrictReceiveSuccess from single-op swap', () => {
      const result = parseSuccessfulTransactionResult(
        swapTransactionPathReceiveResponse.result_xdr,
        scope,
      );

      expect(result).toStrictEqual({
        feeCharged: '100',
        operationResults: [
          {
            type: TransactionResultType.PathPaymentStrictReceiveSuccess,
            amount: '0.19816',
            destination: accountAddress,
            asset: getSlip44AssetId(scope),
          },
        ],
      });
    });

    it('aligns operation results with operation index for multi-op swap', () => {
      const result = parseSuccessfulTransactionResult(
        swapTransactionWithFeeCollectResponse.result_xdr,
        scope,
      );

      expect(result).toStrictEqual({
        feeCharged: '200',
        operationResults: [
          {
            type: TransactionResultType.PathPaymentStrictSendSuccess,
            amount: '0.5257447',
            destination: accountAddress,
            asset: getSlip44AssetId(scope),
          },
          null,
        ],
      });
    });
  });

  describe('xdrAssetToCaip19', () => {
    it('maps native asset', () => {
      const asset = Asset.native().toXDRObject();

      expect(xdrAssetToCaip19(asset, scope)).toBe(getSlip44AssetId(scope));
    });

    it('maps alphanum4 credit asset', () => {
      const asset = new Asset('USDC', usdcIssuer).toXDRObject();

      expect(xdrAssetToCaip19(asset, scope)).toBe(
        toCaip19ClassicAssetId(scope, 'USDC', usdcIssuer),
      );
    });

    it('maps alphanum12 credit asset', () => {
      const asset = new Asset('LONGASSETCD', usdcIssuer).toXDRObject();

      expect(xdrAssetToCaip19(asset, scope)).toBe(
        toCaip19ClassicAssetId(scope, 'LONGASSETCD', usdcIssuer),
      );
    });

    it('returns undefined for pool share asset', () => {
      const asset = Asset.native().toXDRObject();
      jest.spyOn(asset, 'switch').mockReturnValue({
        name: 'assetTypePoolShare',
      } as unknown as xdr.AssetType);

      expect(xdrAssetToCaip19(asset, scope)).toBeUndefined();
    });

    it('returns undefined for unsupported asset type', () => {
      const asset = Asset.native().toXDRObject();
      jest.spyOn(asset, 'switch').mockReturnValue({
        name: 'unsupportedAssetType',
      } as unknown as xdr.AssetType);

      expect(xdrAssetToCaip19(asset, scope)).toBeUndefined();
    });

    it('returns undefined for credit asset when Asset.fromOperation fails', () => {
      const asset = new Asset('USDC', usdcIssuer).toXDRObject();
      jest.spyOn(Asset, 'fromOperation').mockImplementation(() => {
        throw new Error('Invalid asset type: assetTypePoolShare');
      });

      expect(xdrAssetToCaip19(asset, scope)).toBeUndefined();
    });
  });

  describe('parseSep41TransferInvoke', () => {
    const fromAccountId =
      'GA7UCNSASSOPQYTRGJ2NC7TDBSXHMWK6JHS7AO6X2ZQAIQSTB5ELNFSO';
    const toAccountId =
      'GDTF7ERUQVTX23ZD6NY5XRYC5IQAKWFVTQ6IXSMEZWGVNDDGPYCVHRZP';
    const contractId =
      'CBIJBDNZNF4X35BJ4FFZWCDBSCKOP5NB4PLG4SNENRMLAPYG4P5FM6VN';
    const transferArgOptions = [
      { type: 'address' as const },
      { type: 'address' as const },
      { type: 'i128' as const },
    ];

    function buildTransferInvokeOperation(
      functionName: string,
      args: (string | number)[],
      argNativeToScValOptions: readonly (
        | MockInvokeHostFunctionArgNativeToScValOptions
        | undefined
      )[] = transferArgOptions,
    ): Operation.InvokeHostFunction {
      const transaction = buildMockInvokeHostFunctionTransaction(
        functionName,
        args,
        {
          source: { accountId: fromAccountId, sequence: '1' },
          networkPassphrase: caip2ChainIdToNetwork(scope),
          contractId,
          argNativeToScValOptions,
        },
      );
      const [operation] = transaction.transactionOperations;
      return operation as Operation.InvokeHostFunction;
    }

    it('parses a valid SEP-41 transfer invoke', () => {
      const operation = buildTransferInvokeOperation('transfer', [
        fromAccountId,
        toAccountId,
        '100',
      ]);

      expect(parseSep41TransferInvoke(operation, scope)).toStrictEqual({
        assetId: toCaip19Sep41AssetId(scope, contractId),
        fromAccountId,
        toAccountId,
        amount: new BigNumber('100'),
      });
    });

    it('returns true from isSep41TransferInvoke for transfer', () => {
      const operation = buildTransferInvokeOperation('transfer', [
        fromAccountId,
        toAccountId,
        '1',
      ]);

      expect(isSep41TransferInvoke(operation)).toBe(true);
    });

    it('returns false from isSep41TransferInvoke for non-transfer invoke', () => {
      const operation = buildTransferInvokeOperation('balance', [
        fromAccountId,
      ]);

      expect(isSep41TransferInvoke(operation)).toBe(false);
    });

    it('throws XdrParseException when function is not transfer', () => {
      const operation = buildTransferInvokeOperation('balance', [
        fromAccountId,
      ]);

      expect(() => parseSep41TransferInvoke(operation, scope)).toThrow(
        XdrParseException,
      );
      expect(() => parseSep41TransferInvoke(operation, scope)).toThrow(
        'Contract is not a transfer function',
      );
    });

    it('throws XdrParseException when transfer has wrong arg count', () => {
      const operation = buildTransferInvokeOperation(
        'transfer',
        [fromAccountId, toAccountId],
        [{ type: 'address' }, { type: 'address' }],
      );

      expect(() => parseSep41TransferInvoke(operation, scope)).toThrow(
        XdrParseException,
      );
      expect(() => parseSep41TransferInvoke(operation, scope)).toThrow(
        'Invalid transfer function arguments',
      );
    });

    it('returns null from parseSep41TransferInvokeSafe for non-transfer invoke', () => {
      const operation = buildTransferInvokeOperation('balance', [
        fromAccountId,
      ]);

      expect(parseSep41TransferInvokeSafe(operation, scope)).toBeNull();
    });

    it('returns null from parseSep41TransferInvokeSafe when from address is invalid', () => {
      const operation = buildTransferInvokeOperation(
        'transfer',
        [42, toAccountId, '1'],
        [{ type: 'u32' }, { type: 'address' }, { type: 'i128' }],
      );

      expect(parseSep41TransferInvokeSafe(operation, scope)).toBeNull();
    });
  });
});
