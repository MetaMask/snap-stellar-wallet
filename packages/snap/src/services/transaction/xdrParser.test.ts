import type { Operation, xdr } from '@stellar/stellar-sdk';
import { Asset, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import {
  swapTransactionPathReceiveResponse,
  swapTransactionWithFeeCollectResponse,
  swapTransactionWithoutFeeCollectResponse,
} from './__mocks__/horizon-transaction-responses.fixtures';
import { buildMockInvokeHostFunctionTransaction } from './__mocks__/transaction.fixtures';
import type { MockInvokeHostFunctionArgNativeToScValOptions } from './__mocks__/transaction.fixtures';
import { XdrParseException } from './exceptions';
import {
  isSep41TransferInvoke,
  nativeToReadableJson,
  parseSep41TransferInvoke,
  parseSuccessfulTransactionResult,
  parseScValToReadableJson,
  getAddress,
  getFunctionName,
  TransactionResultType,
  xdrAssetToCaip19,
} from './xdrParser';
import { KnownCaip2ChainId } from '../../api';
import {
  getSlip44AssetId,
  toCaip19ClassicAssetId,
  toCaip19Sep41AssetId,
} from '../../utils';
import { bufferToUint8Array } from '../../utils/buffer';
import { caip2ChainIdToNetwork } from '../network/utils';

describe('transaction-xdr-decoder', () => {
  const scope = KnownCaip2ChainId.Mainnet;
  const accountAddress =
    'GA7UCNSASSOPQYTRGJ2NC7TDBSXHMWK6JHS7AO6X2ZQAIQSTB5ELNFSO';
  const usdcIssuer = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

  describe('parseSuccessfulTransactionResult', () => {
    it('throws XdrParseException for invalid xdr', () => {
      expect(() =>
        parseSuccessfulTransactionResult('not-valid-xdr', scope),
      ).toThrow(XdrParseException);
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
  });

  describe('getAddress', () => {
    it('converts contract ScAddress to a C-strkey', () => {
      const contractId =
        'CBIJBDNZNF4X35BJ4FFZWCDBSCKOP5NB4PLG4SNENRMLAPYG4P5FM6VN';
      const wrapped = buildMockInvokeHostFunctionTransaction('transfer', [], {
        contractId,
      });
      const op = wrapped
        .transactionOperations[0] as Operation.InvokeHostFunction;
      const scAddress = op.func.invokeContract().contractAddress();

      expect(getAddress(scAddress)).toBe(contractId);
    });
  });

  describe('getFunctionName', () => {
    it('returns string function names unchanged', () => {
      expect(getFunctionName('approve')).toBe('approve');
    });

    it('decodes byte function names as UTF-8', () => {
      expect(getFunctionName(bufferToUint8Array('transfer', 'utf8'))).toBe(
        'transfer',
      );
    });
  });

  describe('parseScValToReadableJson', () => {
    it('decodes address and i128 ScVals to strkey and decimal strings', () => {
      const address =
        'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
      const wrapped = buildMockInvokeHostFunctionTransaction(
        'swap_exact_amount_in',
        [address, 12n],
        {
          argNativeToScValOptions: [{ type: 'address' }, { type: 'i128' }],
        },
      );
      const op = wrapped
        .transactionOperations[0] as Operation.InvokeHostFunction;
      const [addressArg, amountArg] = op.func.invokeContract().args();

      expect(addressArg).toBeDefined();
      expect(amountArg).toBeDefined();
      expect(parseScValToReadableJson(addressArg as xdr.ScVal)).toBe(address);
      expect(parseScValToReadableJson(amountArg as xdr.ScVal)).toBe('12');
    });

    it('decodes SEP-41 approve args with u32 expiration ledger as a string', () => {
      const from = accountAddress;
      const spender = accountAddress;
      const wrapped = buildMockInvokeHostFunctionTransaction(
        'approve',
        [from, spender, 123n, 0],
        {
          argNativeToScValOptions: [
            { type: 'address' },
            { type: 'address' },
            { type: 'i128' },
            { type: 'u32' },
          ],
        },
      );
      const op = wrapped
        .transactionOperations[0] as Operation.InvokeHostFunction;
      const args = op.func.invokeContract().args();

      expect(args).toHaveLength(4);
      expect(parseScValToReadableJson(args[0] as xdr.ScVal)).toBe(from);
      expect(parseScValToReadableJson(args[1] as xdr.ScVal)).toBe(spender);
      expect(parseScValToReadableJson(args[2] as xdr.ScVal)).toBe('123');
      expect(parseScValToReadableJson(args[3] as xdr.ScVal)).toBe('0');
    });

    it('keeps non-zero u32 values as decimal strings', () => {
      const wrapped = buildMockInvokeHostFunctionTransaction(
        'approve',
        [accountAddress, accountAddress, 23n, 123333],
        {
          argNativeToScValOptions: [
            { type: 'address' },
            { type: 'address' },
            { type: 'i128' },
            { type: 'u32' },
          ],
        },
      );
      const op = wrapped
        .transactionOperations[0] as Operation.InvokeHostFunction;
      const expirationArg = op.func.invokeContract().args()[3];

      expect(expirationArg).toBeDefined();
      expect(parseScValToReadableJson(expirationArg as xdr.ScVal)).toBe(
        '123333',
      );
    });

    it('decodes approve args from a real envelope XDR', () => {
      const envelopeXdr =
        'AAAAAgAAAAA/QTZAlJz4YnEydNF+YwyudlleSeXwO9fWYARCUw9ItgAAAMgDpYayAAACcwAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAGAAAAAAAAAABJbKv015UMxpIkMNjGfee2xjweJ5H/Dh7OzDvLmmlTRoAAAAHYXBwcm92ZQAAAAAEAAAAEgAAAAAAAAAAP0E2QJSc+GJxMnTRfmMMrnZZXknl8DvX1mAEQlMPSLYAAAASAAAAAAAAAAA/QTZAlJz4YnEydNF+YwyudlleSeXwO9fWYARCUw9ItgAAAAoAAAAAAAAAAAAAAAAAAAB7AAAAAwAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
      const tx = TransactionBuilder.fromXDR(envelopeXdr, Networks.PUBLIC);
      const op = tx.operations[0] as Operation.InvokeHostFunction;
      const readableArgs = op.func
        .invokeContract()
        .args()
        .map((arg) => parseScValToReadableJson(arg));

      expect(readableArgs).toStrictEqual([
        accountAddress,
        accountAddress,
        '123',
        '0',
      ]);
    });

    it('returns base64 XDR when scValToNative fails', () => {
      const scv = {
        switch: () => {
          throw new Error('native conversion failed');
        },
        toXDR: (format: string) => {
          expect(format).toBe('base64');
          return 'fallback-base64-xdr';
        },
      } as unknown as xdr.ScVal;

      expect(parseScValToReadableJson(scv)).toBe('fallback-base64-xdr');
    });

    it('converts bigint, bytes, arrays, and maps for display', () => {
      expect(nativeToReadableJson(23n)).toBe('23');
      expect(nativeToReadableJson(new Uint8Array([0xab, 0xcd]))).toBe('abcd');
      expect(nativeToReadableJson([1n, 'x'])).toBe('["1","x"]');
      const map = new Map<unknown, unknown>([
        ['amount', 5n],
        [10n, true],
      ]);
      expect(nativeToReadableJson(map)).toBe(
        JSON.stringify({ amount: '5', '10': 'true' }),
      );
      expect(nativeToReadableJson(null)).toBe('null');
      expect(nativeToReadableJson(true)).toBe('true');
      expect(nativeToReadableJson({ nested: 7n })).toBe(
        JSON.stringify({ nested: '7' }),
      );
    });
  });
});
