import type { xdr } from '@stellar/stellar-sdk';
import { Asset } from '@stellar/stellar-sdk';

import {
  swapTransactionPathReceiveResponse,
  swapTransactionWithFeeCollectResponse,
  swapTransactionWithoutFeeCollectResponse,
} from './__mocks__/horizon-transaction-responses.fixtures';
import {
  parseSuccessfulTransactionResult,
  TransactionResultType,
  xdrAssetToCaip19,
} from './transactionXdrDecoder';
import { KnownCaip2ChainId } from '../../api';
import { getSlip44AssetId, toCaip19ClassicAssetId } from '../../utils';

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
});
