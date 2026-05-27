import { Account as StellarAccount } from '@stellar/stellar-sdk';
import { BigNumber } from 'bignumber.js';

import {
  isHorizonTrustlineMatchingExpectation,
  TrackTransactionTrustlineAction,
} from './trackTransactionHorizonTrustline';
import { KnownCaip2ChainId } from '../../api';
import type { KnownCaip19ClassicAssetId } from '../../api';
import { OnChainAccount } from '../../services/on-chain-account';

const CLASSIC_ASSET_ID =
  'stellar:testnet/asset:GTN-GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF' as KnownCaip19ClassicAssetId;

function createHorizonAccountWithTrustline(limit: string): OnChainAccount {
  const stellarAccount = new StellarAccount(
    'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    '1',
  );
  const onChainAccount = new OnChainAccount(
    stellarAccount,
    KnownCaip2ChainId.Testnet,
  );
  onChainAccount.setAsset(CLASSIC_ASSET_ID, {
    balance: new BigNumber(0),
    symbol: 'GTN',
    limit: new BigNumber(limit),
    address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    authorized: true,
  });
  return onChainAccount;
}

describe('isHorizonTrustlineMatchingExpectation', () => {
  it('returns true for delete when the trustline is absent on Horizon', () => {
    const account = new OnChainAccount(
      new StellarAccount(
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        '1',
      ),
      KnownCaip2ChainId.Testnet,
    );

    expect(
      isHorizonTrustlineMatchingExpectation(
        account,
        CLASSIC_ASSET_ID,
        TrackTransactionTrustlineAction.Delete,
      ),
    ).toBe(true);
  });

  it('returns true for delete when the trustline limit is zero', () => {
    const account = createHorizonAccountWithTrustline('0');

    expect(
      isHorizonTrustlineMatchingExpectation(
        account,
        CLASSIC_ASSET_ID,
        TrackTransactionTrustlineAction.Delete,
      ),
    ).toBe(true);
  });

  it('returns false for delete when the trustline limit is greater than zero', () => {
    const account = createHorizonAccountWithTrustline('9223372036854775807');

    expect(
      isHorizonTrustlineMatchingExpectation(
        account,
        CLASSIC_ASSET_ID,
        TrackTransactionTrustlineAction.Delete,
      ),
    ).toBe(false);
  });

  it('returns true for add when the trustline limit is greater than zero', () => {
    const account = createHorizonAccountWithTrustline('100');

    expect(
      isHorizonTrustlineMatchingExpectation(
        account,
        CLASSIC_ASSET_ID,
        TrackTransactionTrustlineAction.Add,
      ),
    ).toBe(true);
  });

  it('returns false for add when the trustline is absent', () => {
    const account = new OnChainAccount(
      new StellarAccount(
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        '1',
      ),
      KnownCaip2ChainId.Testnet,
    );

    expect(
      isHorizonTrustlineMatchingExpectation(
        account,
        CLASSIC_ASSET_ID,
        TrackTransactionTrustlineAction.Add,
      ),
    ).toBe(false);
  });
});
