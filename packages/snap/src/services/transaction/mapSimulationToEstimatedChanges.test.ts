import { BigNumber } from 'bignumber.js';

import { mapSimulationToEstimatedChanges } from './mapSimulationToEstimatedChanges';
import type { AccountState, SimulationState } from './simulation';
import { KnownCaip2ChainId } from '../../api';
import { toCaip19ClassicAssetId } from '../../utils';
import type { AssetMetadataService } from '../asset-metadata';

describe('mapSimulationToEstimatedChanges', () => {
  const scope = KnownCaip2ChainId.Mainnet;
  const signerAddress =
    'GDPMFLKUGASUTWBN2XGYYKD27QGHCYH4BUFUTER4L23INYQ4JHDWFOIE';
  const usdcIssuer = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

  const assetMetadataService = {
    resolve: jest.fn(),
  } as unknown as AssetMetadataService;

  function buildAccountState(overrides: Partial<AccountState>): AccountState {
    return {
      nativeRawBalance: new BigNumber(0),
      subentryCount: 0,
      numSponsoring: 0,
      numSponsored: 0,
      requiresMemo: false,
      trustlines: new Map(),
      sep41Balances: new Map(),
      ...overrides,
    };
  }

  function buildState(accountState: AccountState): SimulationState {
    return { accounts: new Map([[signerAddress, accountState]]) };
  }

  it('maps a native XLM outflow excluding the fee (post-fee baseline)', async () => {
    // Both snapshots are post-fee, so the only diff is the payment amount.
    const result = await mapSimulationToEstimatedChanges({
      initialState: buildState(
        buildAccountState({ nativeRawBalance: new BigNumber('1000000000') }),
      ),
      finalState: buildState(
        buildAccountState({ nativeRawBalance: new BigNumber('900000000') }),
      ),
      signerAddress,
      scope,
      assetMetadataService,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: 'out',
      value: 10,
      price: null,
      symbol: 'XLM',
    });
    expect(assetMetadataService.resolve).not.toHaveBeenCalled();
  });

  it('maps a classic asset payment from the signer trustline', async () => {
    const usdc = toCaip19ClassicAssetId(scope, 'USDC', usdcIssuer);
    const trustline = {
      limit: new BigNumber('1000000000000'),
      authorized: true,
      sponsored: false,
    };

    const result = await mapSimulationToEstimatedChanges({
      initialState: buildState(
        buildAccountState({
          trustlines: new Map([
            [usdc, { ...trustline, balance: new BigNumber('5000000') }],
          ]),
        }),
      ),
      finalState: buildState(
        buildAccountState({
          trustlines: new Map([
            [usdc, { ...trustline, balance: new BigNumber('3000000') }],
          ]),
        }),
      ),
      signerAddress,
      scope,
      assetMetadataService,
    });

    expect(result).toStrictEqual([
      {
        type: 'out',
        value: 0.2,
        price: null,
        symbol: 'USDC',
        name: 'USDC',
        logo: expect.any(String),
      },
    ]);
  });

  it('returns an empty array when there are no balance changes', async () => {
    const accountState = buildAccountState({
      nativeRawBalance: new BigNumber('1000000000'),
    });

    const result = await mapSimulationToEstimatedChanges({
      initialState: buildState(accountState),
      finalState: buildState(accountState),
      signerAddress,
      scope,
      assetMetadataService,
    });

    expect(result).toStrictEqual([]);
  });

  it('returns an empty array when the signer is absent from a snapshot', async () => {
    const result = await mapSimulationToEstimatedChanges({
      initialState: { accounts: new Map() },
      finalState: { accounts: new Map() },
      signerAddress,
      scope,
      assetMetadataService,
    });

    expect(result).toStrictEqual([]);
  });
});
