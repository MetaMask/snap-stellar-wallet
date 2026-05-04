import { UserRejectedRequestError } from '@metamask/snaps-sdk';
import { Address, xdr } from '@stellar/stellar-sdk';

import type { SignAuthEntryRequest, SignAuthEntryResponse } from './api';
import { SignAuthEntryRequestStruct, SignAuthEntryResponseStruct } from './api';
import { BaseSep43KeyringHandler } from './base';
import type { Sep43Error } from './exceptions';
import type {
  AccountService,
  StellarKeyringAccount,
} from '../../services/account';
import type { Wallet, WalletService } from '../../services/wallet';
import { ConfirmationInterfaceKey } from '../../ui/confirmation/api';
import type { ConfirmationUXController } from '../../ui/confirmation/controller';
import type { ILogger } from '../../utils';

/**
 * Human-readable Soroban auth entry summary rendered in the confirmation
 * dialog. The struct guarantees the preimage parses and is the Soroban
 * authorization variant; this shape extracts only the fields a user can
 * meaningfully verify.
 */
export type ReadableAuthEntry = {
  /** `'invoke'` for direct contract calls, `'createContract'` / `'createContractV2'` for deployments. */
  functionType: 'invoke' | 'createContract' | 'createContractV2';
  /** Strkey-encoded contract `C…` address being invoked, or `null` for contract-creation entries. */
  contractAddress: string | null;
  /** Function being invoked, or `null` for contract-creation entries. */
  functionName: string | null;
  /** Ledger sequence at which this authorization expires (exclusive). */
  signatureExpirationLedger: number;
  /** Replay-protection nonce. */
  nonce: string;
  /** Count of nested invocations the user is also authorizing. */
  subInvocationsCount: number;
};

/**
 * SEP-43 `signAuthEntry` keyring handler.
 *
 * The dapp passes a base64-encoded `HashIdPreimage`
 * (envelopeTypeSorobanAuthorization). The handler decodes it for display in
 * the confirmation dialog and, on confirm, asks the wallet to
 * `sha256(preimage) → ed25519 sign`. The network passphrase is already
 * baked into the preimage's `networkId`, so no additional prefix is applied.
 *
 * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0043.md
 */
export class SignAuthEntryHandler extends BaseSep43KeyringHandler<
  SignAuthEntryRequest,
  SignAuthEntryResponse
> {
  readonly #confirmationUIController: ConfirmationUXController;

  constructor({
    logger,
    accountService,
    walletService,
    confirmationUIController,
  }: {
    logger: ILogger;
    accountService: AccountService;
    walletService: WalletService;
    confirmationUIController: ConfirmationUXController;
  }) {
    super({
      logger,
      accountService,
      walletService,
      loggerPrefix: '[🛂 SignAuthEntryHandler]',
      requestStruct: SignAuthEntryRequestStruct,
      responseStruct: SignAuthEntryResponseStruct,
    });
    this.#confirmationUIController = confirmationUIController;
  }

  protected async execute(
    request: SignAuthEntryRequest,
    resolved: { account: StellarKeyringAccount; wallet: Wallet },
  ): Promise<SignAuthEntryResponse> {
    const { account, wallet } = resolved;
    const { authEntry } = request.request.params;

    const readableAuthEntry = decodeSorobanAuthPreimage(authEntry);

    if (!(await this.#confirm(request, account, readableAuthEntry))) {
      throw new UserRejectedRequestError() as unknown as Error;
    }

    const signedAuthEntry = await wallet.signAuthEntry(authEntry);

    return {
      signedAuthEntry,
      signerAddress: account.address,
    };
  }

  protected toErrorResponse(
    signerAddress: string,
    error: Sep43Error,
  ): SignAuthEntryResponse {
    return {
      // SEP-43 schema requires the field even on error; keep it empty when unknown.
      signedAuthEntry: '',
      signerAddress,
      error: error.toJSON(),
    };
  }

  async #confirm(
    request: SignAuthEntryRequest,
    account: StellarKeyringAccount,
    readableAuthEntry: ReadableAuthEntry,
  ): Promise<boolean> {
    return (
      (await this.#confirmationUIController.renderConfirmationDialog({
        scope: request.scope,
        renderContext: {
          account,
          readableAuthEntry,
        },
        origin: request.origin,
        interfaceKey: ConfirmationInterfaceKey.SignAuthEntry,
      })) === true
    );
  }
}

/**
 * Decodes a SEP-43 `signAuthEntry` payload into the user-facing summary.
 * The struct has already validated that the input parses as
 * `HashIdPreimage.envelopeTypeSorobanAuthorization`, so the cast is safe.
 *
 * @param authEntry - Base64-encoded `HashIdPreimage` XDR.
 * @returns Fields displayed in the confirmation dialog.
 */
function decodeSorobanAuthPreimage(authEntry: string): ReadableAuthEntry {
  const preimage = xdr.HashIdPreimage.fromXDR(authEntry, 'base64');
  const sorobanAuth = preimage.sorobanAuthorization();
  const fn = sorobanAuth.invocation().function();

  let functionType: ReadableAuthEntry['functionType'];
  let contractAddress: string | null;
  let functionName: string | null;
  switch (fn.switch()) {
    case xdr.SorobanAuthorizedFunctionType.sorobanAuthorizedFunctionTypeContractFn(): {
      const args = fn.contractFn();
      functionType = 'invoke';
      contractAddress = Address.fromScAddress(
        args.contractAddress(),
      ).toString();
      functionName = readFunctionName(args.functionName());
      break;
    }
    case xdr.SorobanAuthorizedFunctionType.sorobanAuthorizedFunctionTypeCreateContractHostFn():
      functionType = 'createContract';
      contractAddress = null;
      functionName = null;
      break;
    case xdr.SorobanAuthorizedFunctionType.sorobanAuthorizedFunctionTypeCreateContractV2HostFn():
      functionType = 'createContractV2';
      contractAddress = null;
      functionName = null;
      break;
    /* istanbul ignore next — exhaustive switch over an SDK enum */
    default:
      functionType = 'invoke';
      contractAddress = null;
      functionName = null;
  }

  return {
    functionType,
    contractAddress,
    functionName,
    signatureExpirationLedger: sorobanAuth.signatureExpirationLedger(),
    nonce: sorobanAuth.nonce().toString(),
    subInvocationsCount: sorobanAuth.invocation().subInvocations().length,
  };
}

/**
 * `functionName` is typed `string | Buffer` by the SDK because the XDR
 * field carries raw bytes. Normalize to a UTF-8 string for display.
 *
 * @param fnName - Function name as returned by the SDK.
 * @returns The function name as a UTF-8 string.
 */
function readFunctionName(fnName: string | Buffer): string {
  return typeof fnName === 'string' ? fnName : fnName.toString('utf8');
}

/* istanbul ignore next — re-export for tests */
export { decodeSorobanAuthPreimage };
