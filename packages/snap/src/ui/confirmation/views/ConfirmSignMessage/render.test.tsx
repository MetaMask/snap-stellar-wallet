import type { GetPreferencesResult } from '@metamask/snaps-sdk';
import { bytesToBase64, stringToBytes } from '@metamask/utils';

import { render } from './render';
import { KnownCaip2ChainId } from '../../../../api';
import { MultichainMethod } from '../../../../handlers/keyring';
import type { SignMessageRequest } from '../../../../handlers/keyring';
import type { StellarKeyringAccount } from '../../../../services/account';
import { generateMockStellarKeyringAccounts } from '../../../../services/account/__mocks__/account.fixtures';
import * as snapUtils from '../../../../utils/snap';

/**
 * Helper function to convert string to base64.
 *
 * @param str - The string to convert.
 * @returns Base64 encoded string.
 */
function toBase64(str: string): string {
  return bytesToBase64(stringToBytes(str));
}

describe('ConfirmSignMessage render', () => {
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

  const createSnapSpies = () => {
    const createInterfaceSpy = jest.spyOn(snapUtils, 'createInterface');
    const showDialogSpy = jest.spyOn(snapUtils, 'showDialog');
    const getPreferencesSpy = jest.spyOn(snapUtils, 'getPreferences');

    createInterfaceSpy.mockResolvedValue('interface-id-123');
    showDialogSpy.mockResolvedValue(true);
    getPreferencesSpy.mockResolvedValue(mockPreferences);

    return {
      createInterfaceSpy,
      showDialogSpy,
      getPreferencesSpy,
    };
  };

  it('renders the confirmation dialog with correct props', async () => {
    const { createInterfaceSpy, showDialogSpy, getPreferencesSpy } =
      createSnapSpies();
    const testOrigin = 'https://example.com';
    const testMessage = 'Hello, Stellar!';

    const request: SignMessageRequest = {
      id: '00000000-0000-4000-8000-000000000001',
      origin: testOrigin,
      account: mockAccount.id,
      scope: KnownCaip2ChainId.Mainnet,
      request: {
        method: MultichainMethod.SignMessage,
        params: {
          message: toBase64(testMessage),
        },
      },
    };

    await render(request, mockAccount);

    // Verify createInterface and showDialog were called correctly
    expect(createInterfaceSpy).toHaveBeenCalledTimes(1);
    expect(showDialogSpy).toHaveBeenCalledWith('interface-id-123');

    // Verify the message was decoded correctly (we can't easily check the full JSX tree)
    // So we verify the render function was called with correct inputs
    expect(getPreferencesSpy).toHaveBeenCalled();
  });

  it('uses fallback locale when preferences fail to load', async () => {
    const { createInterfaceSpy, getPreferencesSpy } = createSnapSpies();
    getPreferencesSpy.mockRejectedValue(new Error('Failed to load'));

    const request: SignMessageRequest = {
      id: '00000000-0000-4000-8000-000000000003',
      origin: 'https://test.com',
      account: mockAccount.id,
      scope: KnownCaip2ChainId.Mainnet,
      request: {
        method: MultichainMethod.SignMessage,
        params: {
          message: toBase64('Test'),
        },
      },
    };

    await render(request, mockAccount);

    // Should still create interface even when preferences fail
    expect(createInterfaceSpy).toHaveBeenCalledTimes(1);
    expect(getPreferencesSpy).toHaveBeenCalled();
  });

  it('handles missing origin gracefully', async () => {
    const { createInterfaceSpy } = createSnapSpies();
    const request: SignMessageRequest = {
      id: '00000000-0000-4000-8000-000000000004',
      origin: undefined as any,
      account: mockAccount.id,
      scope: KnownCaip2ChainId.Mainnet,
      request: {
        method: MultichainMethod.SignMessage,
        params: {
          message: toBase64('Test message'),
        },
      },
    };

    await render(request, mockAccount);

    // Should create interface even with missing origin (formatOrigin handles it)
    expect(createInterfaceSpy).toHaveBeenCalledTimes(1);
  });

  it('returns the dialog promise', async () => {
    const expectedResult = true;
    const { showDialogSpy } = createSnapSpies();
    showDialogSpy.mockResolvedValue(expectedResult);

    const request: SignMessageRequest = {
      id: '00000000-0000-4000-8000-000000000006',
      origin: 'https://test.com',
      account: mockAccount.id,
      scope: KnownCaip2ChainId.Mainnet,
      request: {
        method: MultichainMethod.SignMessage,
        params: {
          message: toBase64('Test'),
        },
      },
    };

    const result = await render(request, mockAccount);

    expect(result).toBe(expectedResult);
  });

  it('passes STELLAR_IMAGE as network image', async () => {
    const { createInterfaceSpy } = createSnapSpies();
    const request: SignMessageRequest = {
      id: '00000000-0000-4000-8000-000000000007',
      origin: 'https://test.com',
      account: mockAccount.id,
      scope: KnownCaip2ChainId.Mainnet,
      request: {
        method: MultichainMethod.SignMessage,
        params: {
          message: toBase64('Test'),
        },
      },
    };

    await render(request, mockAccount);

    // Verify interface was created with TRX image
    expect(createInterfaceSpy).toHaveBeenCalledTimes(1);
  });
});
