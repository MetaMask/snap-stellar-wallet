import type { GetPreferencesResult } from '@metamask/snaps-sdk';
import { Keypair } from '@stellar/stellar-sdk';

import { render } from './render';
import { KnownCaip2ChainId } from '../../../../api';
import { MultichainMethod } from '../../../../handlers/keyring';
import type { SignTransactionRequest } from '../../../../handlers/keyring';
import type { StellarKeyringAccount } from '../../../../services/account';
import { generateMockStellarKeyringAccounts } from '../../../../services/account/__mocks__/account.fixtures';
import type { Transaction } from '../../../../services/transaction';
import { buildMockClassicTransaction } from '../../../../services/transaction/__mocks__/transaction.fixtures';
import * as snapUtils from '../../../../utils/snap';

describe('ConfirmSignTransaction render', () => {
  const mockAccount = generateMockStellarKeyringAccounts(
    1,
    'entropy-source-1',
  )[0] as StellarKeyringAccount;
  const mockPreferences: GetPreferencesResult = {
    locale: 'en',
    currency: 'usd',
    hideBalances: false,
    useSecurityAlerts: true,
    useExternalPricingData: true,
    simulateOnChainActions: true,
    useTokenDetection: true,
    batchCheckBalances: true,
    displayNftMedia: true,
    useNftDetection: true,
    showTestnets: false,
  };

  const destination = Keypair.random().publicKey();

  const createSnapSpies = () => {
    const createInterfaceSpy = jest.spyOn(snapUtils, 'createInterface');
    const showDialogSpy = jest.spyOn(snapUtils, 'showDialog');
    const getPreferencesSpy = jest.spyOn(snapUtils, 'getPreferences');

    createInterfaceSpy.mockResolvedValue('interface-id-123');
    showDialogSpy.mockResolvedValue(true);
    getPreferencesSpy.mockResolvedValue(mockPreferences);

    return { createInterfaceSpy, showDialogSpy, getPreferencesSpy };
  };

  const createRequest = (
    overrides: Partial<SignTransactionRequest> = {},
  ): SignTransactionRequest => ({
    id: '00000000-0000-4000-8000-000000000001',
    origin: 'https://example.com',
    account: mockAccount.id,
    scope: KnownCaip2ChainId.Testnet,
    request: {
      method: MultichainMethod.SignTransaction,
      params: { transaction: 'dummy-xdr' },
    },
    ...overrides,
  });

  const buildSinglePaymentTx = (): Transaction =>
    buildMockClassicTransaction([
      {
        type: 'payment',
        params: { destination, asset: 'native', amount: '100' },
      },
    ]);

  it('renders the confirmation dialog and returns the dialog result', async () => {
    const { createInterfaceSpy, showDialogSpy, getPreferencesSpy } =
      createSnapSpies();

    const transaction = buildSinglePaymentTx();
    const result = await render(createRequest(), transaction, mockAccount);

    expect(getPreferencesSpy).toHaveBeenCalled();
    expect(createInterfaceSpy).toHaveBeenCalledTimes(1);
    expect(showDialogSpy).toHaveBeenCalledWith('interface-id-123');
    expect(result).toBe(true);
  });

  it('renders with multiple operations', async () => {
    const { createInterfaceSpy } = createSnapSpies();

    const transaction = buildMockClassicTransaction([
      {
        type: 'payment',
        params: { destination, asset: 'native', amount: '50' },
      },
      {
        type: 'createAccount',
        params: { destination, startingBalance: '10' },
      },
      {
        type: 'changeTrust',
        params: {
          asset: { code: 'USD', issuer: destination },
          limit: '1000',
        },
      },
    ]);

    await render(createRequest(), transaction, mockAccount);

    expect(createInterfaceSpy).toHaveBeenCalledTimes(1);
  });

  it('renders with an operation that has an explicit source', async () => {
    const { createInterfaceSpy } = createSnapSpies();
    const opSource = Keypair.random().publicKey();

    const transaction = buildMockClassicTransaction([
      {
        type: 'payment',
        params: {
          destination,
          asset: 'native',
          amount: '10',
          source: opSource,
        },
      },
    ]);

    await render(createRequest(), transaction, mockAccount);

    expect(createInterfaceSpy).toHaveBeenCalledTimes(1);
  });

  it('uses fallback locale when preferences fail to load', async () => {
    const { createInterfaceSpy, getPreferencesSpy } = createSnapSpies();
    getPreferencesSpy.mockRejectedValue(new Error('Failed to load'));

    const transaction = buildSinglePaymentTx();
    await render(createRequest(), transaction, mockAccount);

    expect(createInterfaceSpy).toHaveBeenCalledTimes(1);
    expect(getPreferencesSpy).toHaveBeenCalled();
  });

  it('handles missing origin gracefully', async () => {
    const { createInterfaceSpy } = createSnapSpies();

    const transaction = buildSinglePaymentTx();
    await render(
      createRequest({ origin: undefined as any }),
      transaction,
      mockAccount,
    );

    expect(createInterfaceSpy).toHaveBeenCalledTimes(1);
  });

  it('renders with setOptions operation (conditional params)', async () => {
    const { createInterfaceSpy } = createSnapSpies();

    const transaction = buildMockClassicTransaction([
      {
        type: 'setOptions',
        params: { setFlags: 1, clearFlags: 2 },
      },
    ]);

    await render(createRequest(), transaction, mockAccount);

    expect(createInterfaceSpy).toHaveBeenCalledTimes(1);
  });
});
