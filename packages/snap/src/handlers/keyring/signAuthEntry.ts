import { UserRejectedRequestError } from '@metamask/snaps-sdk';
import { xdr } from '@stellar/stellar-sdk';

import type { SignAuthEntryRequest, SignAuthEntryResponse } from './api';
import { SignAuthEntryRequestStruct, SignAuthEntryResponseStruct } from './api';
import type { AccountResolver } from '../accountResolver';
import { BaseSep43KeyringHandler } from './base';
import type { Sep43Error } from './exceptions';
import type { StellarKeyringAccount } from '../../services/account';
import type { ReadableAuthorizationJson } from '../../services/transaction';
import { AuthorizationMapper } from '../../services/transaction';
import type { Wallet } from '../../services/wallet';
import { ConfirmationInterfaceKey } from '../../ui/confirmation/api';
import type { ConfirmationUXController } from '../../ui/confirmation/controller';
import type { ILogger } from '../../utils';

/**
 * Human-readable Soroban auth entry summary rendered in the confirmation
 * dialog. Invocation details come from {@link AuthorizationMapper}; nonce and
 * expiry are preimage-only fields.
 */
export type ReadableAuthEntry = {
  /** Flat list: root invocation first, then depth-first sub-invocations. */
  authorizations: ReadableAuthorizationJson[];
  /** Ledger sequence at which this authorization expires (exclusive). */
  signatureExpirationLedger: number;
  /** Replay-protection nonce. */
  nonce: string;
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
    accountResolver,
    confirmationUIController,
  }: {
    logger: ILogger;
    accountResolver: AccountResolver;
    confirmationUIController: ConfirmationUXController;
  }) {
    super({
      logger,
      accountResolver,
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

    const readableAuthEntry = this.#decodeSorobanAuthPreimage(authEntry);

    if (!(await this.#confirm(request, account, readableAuthEntry))) {
      throw new UserRejectedRequestError() as unknown as Error;
    }

    const signedAuthEntry = wallet.signAuthEntry(authEntry);

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

  /**
   * Decodes a SEP-43 `signAuthEntry` payload into the user-facing summary.
   * The struct has already validated that the input parses as
   * `HashIdPreimage.envelopeTypeSorobanAuthorization`, so the cast is safe.
   *
   * @param authEntry - Base64-encoded `HashIdPreimage` XDR.
   * @returns Fields displayed in the confirmation dialog.
   */
  #decodeSorobanAuthPreimage(authEntry: string): ReadableAuthEntry {
    const preimage = xdr.HashIdPreimage.fromXDR(authEntry, 'base64');
    const sorobanAuth = preimage.sorobanAuthorization();

    return {
      authorizations: new AuthorizationMapper().mapInvocation(
        sorobanAuth.invocation(),
      ),
      signatureExpirationLedger: sorobanAuth.signatureExpirationLedger(),
      nonce: sorobanAuth.nonce().toString(),
    };
  }
}
