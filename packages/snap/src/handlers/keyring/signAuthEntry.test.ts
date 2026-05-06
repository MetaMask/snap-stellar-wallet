import { Address, Keypair, Networks, hash, xdr } from '@stellar/stellar-sdk';

import { MultichainMethod, type SignAuthEntryRequest } from './api';
import { Sep43ErrorCode } from './exceptions';
import { SignAuthEntryHandler } from './signAuthEntry';
import { KnownCaip2ChainId } from '../../api';
import { AccountService } from '../../services/account';
import {
  generateStellarKeyringAccount,
  mockAccountService,
} from '../../services/account/__mocks__/account.fixtures';
import { WalletService } from '../../services/wallet';
import { getTestWallet } from '../../services/wallet/__mocks__/wallet.fixtures';
import type { ConfirmationUXController } from '../../ui/confirmation/controller';
import { bufferToUint8Array } from '../../utils/buffer';
import { logger } from '../../utils/logger';

jest.mock('../../utils/logger');

/**
 * Builds a minimal but valid base64-encoded `HashIdPreimage`
 * (envelopeTypeSorobanAuthorization) for tests. The field values are
 * arbitrary — we only need the XDR to round-trip through superstruct
 * validation and the handler's preimage decoder.
 *
 * @param options - Optional overrides for the generated preimage.
 * @param options.networkPassphrase - Network passphrase to embed as
 * `networkId`. Defaults to mainnet so happy-path tests pass
 * `HashIdPreimageXdrStruct`'s mainnet-only check.
 * @param options.args - `ScVal` arguments to attach to the contract function.
 * Defaults to no arguments (matching a `transfer` with empty args list).
 * @param options.subInvocations - Nested authorized invocations to attach.
 * Defaults to an empty list.
 * @returns Base64 XDR of a Soroban authorization preimage.
 */
function buildAuthEntryPreimageXdr({
  networkPassphrase = Networks.PUBLIC,
  args = [],
  subInvocations = [],
}: {
  networkPassphrase?: string;
  args?: xdr.ScVal[];
  subInvocations?: xdr.SorobanAuthorizedInvocation[];
} = {}): string {
  const contractIdBytes = new Uint8Array(32).fill(1);
  const contractAddress = Address.contract(
    bufferToUint8Array(contractIdBytes),
  ).toScAddress();
  const invokeContractArgs = new xdr.InvokeContractArgs({
    contractAddress,
    functionName: 'transfer',
    args,
  });
  const fn =
    xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      invokeContractArgs,
    );
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: fn,
    subInvocations,
  });
  const sorobanAuth = new xdr.HashIdPreimageSorobanAuthorization({
    networkId: hash(bufferToUint8Array(networkPassphrase, 'utf8')),
    nonce: xdr.Int64.fromString('123456789'),
    signatureExpirationLedger: 1_000_000,
    invocation,
  });
  return xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(sorobanAuth)
    .toXDR()
    .toString('base64');
}

describe('SignAuthEntryHandler', () => {
  /**
   * Builds a {@link SignAuthEntryHandler} with mocked account / wallet
   * resolution and a stubbed `ConfirmationUXController`.
   *
   * @returns Handler instance and the test doubles needed by each spec.
   */
  function setupHandler() {
    const wallet = getTestWallet();
    const accountId = globalThis.crypto.randomUUID();
    const mockAccount = generateStellarKeyringAccount(
      accountId,
      wallet.address,
      'entropy-source-1',
      0,
    );

    const { accountService, walletService } = mockAccountService();

    jest
      .spyOn(AccountService.prototype, 'resolveAccount')
      .mockResolvedValue({ account: mockAccount });

    jest
      .spyOn(WalletService.prototype, 'resolveWallet')
      .mockResolvedValue(wallet);

    const renderConfirmationDialog = jest.fn();
    const confirmationUIController = {
      renderConfirmationDialog,
    } as Pick<
      ConfirmationUXController,
      'renderConfirmationDialog'
    > as unknown as ConfirmationUXController;

    const handler = new SignAuthEntryHandler({
      logger,
      accountService,
      walletService,
      confirmationUIController,
    });

    return {
      handler,
      mockAccount,
      wallet,
      renderConfirmationDialog,
    };
  }

  const validAuthEntry = buildAuthEntryPreimageXdr();

  const buildRequest = (
    accountId: string,
    overrides: Partial<SignAuthEntryRequest['request']['params']> = {},
  ): SignAuthEntryRequest => ({
    id: '11111111-1111-4111-8111-111111111111',
    origin: 'https://example.com',
    scope: KnownCaip2ChainId.Mainnet,
    account: accountId,
    request: {
      method: MultichainMethod.SignAuthEntry,
      params: {
        authEntry: validAuthEntry,
        ...overrides,
      },
    },
  });

  it('returns signedAuthEntry and signerAddress on confirm', async () => {
    const { handler, mockAccount, wallet, renderConfirmationDialog } =
      setupHandler();
    renderConfirmationDialog.mockResolvedValue(true);

    const result = await handler.handle(buildRequest(mockAccount.id));

    const expected = await wallet.signAuthEntry(validAuthEntry);
    expect(result).toStrictEqual({
      signedAuthEntry: expected,
      signerAddress: wallet.address,
    });
  });

  it('passes a decoded readable preimage to the confirmation dialog', async () => {
    const { handler, mockAccount, renderConfirmationDialog } = setupHandler();
    renderConfirmationDialog.mockResolvedValue(true);

    await handler.handle(buildRequest(mockAccount.id));

    expect(renderConfirmationDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        renderContext: expect.objectContaining({
          readableAuthEntry: expect.objectContaining({
            functionType: 'invoke',
            functionName: 'transfer',
            signatureExpirationLedger: 1_000_000,
            nonce: '123456789',
            args: [],
            subInvocations: [],
            contractAddress: expect.stringMatching(/^C[A-Z2-7]+$/u),
          }),
        }),
      }),
    );
  });

  it('decodes function arguments and nested sub-invocations into the readable preimage', async () => {
    const { handler, mockAccount, renderConfirmationDialog } = setupHandler();
    renderConfirmationDialog.mockResolvedValue(true);

    // transfer(to: G…, amount: 10) wrapped around a single nested call to
    // verify both args decoding (address strkey + i128) and recursive
    // sub-invocation decoding.
    const recipient = Keypair.random().publicKey();
    const args = [
      xdr.ScVal.scvAddress(Address.fromString(recipient).toScAddress()),
      xdr.ScVal.scvI128(
        new xdr.Int128Parts({
          hi: xdr.Int64.fromString('0'),
          lo: xdr.Uint64.fromString('10'),
        }),
      ),
    ];
    const nestedInvocation = new xdr.SorobanAuthorizedInvocation({
      function:
        xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          new xdr.InvokeContractArgs({
            contractAddress: Address.contract(
              bufferToUint8Array(new Uint8Array(32).fill(2)),
            ).toScAddress(),
            functionName: 'approve',
            args: [],
          }),
        ),
      subInvocations: [],
    });
    const authEntry = buildAuthEntryPreimageXdr({
      args,
      subInvocations: [nestedInvocation],
    });

    await handler.handle(buildRequest(mockAccount.id, { authEntry }));

    expect(renderConfirmationDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        renderContext: expect.objectContaining({
          readableAuthEntry: expect.objectContaining({
            functionName: 'transfer',
            args: [JSON.stringify(recipient), JSON.stringify('10')],
            subInvocations: [
              expect.objectContaining({
                functionType: 'invoke',
                functionName: 'approve',
                args: [],
                subInvocations: [],
              }),
            ],
          }),
        }),
      }),
    );
  });

  it('returns error -4 when user rejects', async () => {
    const { handler, mockAccount, wallet, renderConfirmationDialog } =
      setupHandler();
    renderConfirmationDialog.mockResolvedValue(false);

    const result = await handler.handle(buildRequest(mockAccount.id));

    expect(result).toMatchObject({
      signedAuthEntry: '',
      signerAddress: wallet.address,
      error: { code: Sep43ErrorCode.UserRejected },
    });
  });

  it('returns error -3 when scope is testnet', async () => {
    const { handler, mockAccount, renderConfirmationDialog } = setupHandler();

    const result = await handler.handle({
      ...buildRequest(mockAccount.id),
      scope: KnownCaip2ChainId.Testnet,
    });

    expect(result).toMatchObject({
      signedAuthEntry: '',
      signerAddress: '',
      error: { code: Sep43ErrorCode.InvalidRequest },
    });
    expect(renderConfirmationDialog).not.toHaveBeenCalled();
  });

  it('returns error -3 when opts.networkPassphrase is not the mainnet passphrase', async () => {
    const { handler, mockAccount, renderConfirmationDialog } = setupHandler();

    const result = await handler.handle(
      buildRequest(mockAccount.id, {
        opts: { networkPassphrase: Networks.TESTNET },
      }),
    );

    expect(result).toMatchObject({
      error: {
        code: Sep43ErrorCode.InvalidRequest,
        ext: [expect.stringContaining('mainnet')],
      },
    });
    expect(renderConfirmationDialog).not.toHaveBeenCalled();
  });

  it.each([
    ['opts.submit', { submit: true }],
    ['opts.submitUrl', { submitUrl: 'https://horizon.stellar.org' }],
  ])('returns error -3 when %s is provided', async (_label, forbiddenOpts) => {
    const { handler, mockAccount, renderConfirmationDialog } = setupHandler();

    const base = buildRequest(mockAccount.id);
    // Inject the forbidden opt bypassing the struct type so we can assert the
    // handler rejects it at runtime with -3 InvalidRequest.
    (base.request.params as unknown as { opts: Record<string, unknown> }).opts =
      forbiddenOpts;

    const result = await handler.handle(base);

    expect(result).toMatchObject({
      error: { code: Sep43ErrorCode.InvalidRequest },
    });
    expect(renderConfirmationDialog).not.toHaveBeenCalled();
  });

  it('returns error -3 when authEntry is not valid base64 XDR', async () => {
    const { handler, mockAccount, renderConfirmationDialog } = setupHandler();

    const result = await handler.handle(
      buildRequest(mockAccount.id, { authEntry: 'not-base64-xdr' }),
    );

    expect(result).toMatchObject({
      error: { code: Sep43ErrorCode.InvalidRequest },
    });
    expect(renderConfirmationDialog).not.toHaveBeenCalled();
  });

  it("returns error -3 when authEntry's embedded networkId is not mainnet", async () => {
    const { handler, mockAccount, renderConfirmationDialog } = setupHandler();

    // Same shape as the mainnet fixture, but with the embedded `networkId`
    // bound to testnet. The keyring `scope`/`opts.networkPassphrase` look
    // mainnet-y, so without the networkId check the snap would happily sign
    // a Soroban auth signature valid only against testnet.
    const testnetAuthEntry = buildAuthEntryPreimageXdr({
      networkPassphrase: Networks.TESTNET,
    });

    const result = await handler.handle(
      buildRequest(mockAccount.id, { authEntry: testnetAuthEntry }),
    );

    expect(result).toMatchObject({
      error: {
        code: Sep43ErrorCode.InvalidRequest,
        ext: [expect.stringContaining('networkId')],
      },
    });
    expect(renderConfirmationDialog).not.toHaveBeenCalled();
  });

  it('returns error -3 when authEntry is a non-Soroban HashIdPreimage', async () => {
    const { handler, mockAccount, renderConfirmationDialog } = setupHandler();

    // A HashIdPreimage of a different envelope type (envelopeTypeContractId)
    // must be rejected — only Soroban authorization preimages are signable
    // here. We pick this variant because its inner shape only needs a
    // network ID + a contract ID preimage, no account/sequence types.
    const wrongPreimage = xdr.HashIdPreimage.envelopeTypeContractId(
      new xdr.HashIdPreimageContractId({
        networkId: hash(bufferToUint8Array(Networks.PUBLIC, 'utf8')),
        contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAsset(
          xdr.Asset.assetTypeNative(),
        ),
      }),
    )
      .toXDR()
      .toString('base64');

    const result = await handler.handle(
      buildRequest(mockAccount.id, { authEntry: wrongPreimage }),
    );

    expect(result).toMatchObject({
      error: { code: Sep43ErrorCode.InvalidRequest },
    });
    expect(renderConfirmationDialog).not.toHaveBeenCalled();
  });

  it('ignores opts.address: signer is always determined by the keyring account UUID', async () => {
    const { handler, mockAccount, wallet, renderConfirmationDialog } =
      setupHandler();
    renderConfirmationDialog.mockResolvedValue(true);

    // Different valid Stellar G-address — MetaMask already routed to
    // `mockAccount` via the UUID, so this MUST be ignored.
    const otherAddress = Keypair.random().publicKey();

    const result = await handler.handle(
      buildRequest(mockAccount.id, { opts: { address: otherAddress } }),
    );

    const expected = await wallet.signAuthEntry(validAuthEntry);
    expect(result).toStrictEqual({
      signedAuthEntry: expected,
      signerAddress: wallet.address,
    });
  });
});
