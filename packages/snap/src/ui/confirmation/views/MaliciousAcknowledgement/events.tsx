import type { InputChangeEvent } from '@metamask/snaps-sdk';
import type { Json } from '@metamask/utils';

import { MaliciousAcknowledgementFormNames } from './constants';
import type {
  UserInputUiEventHandler,
  UserInputUiEventHandlerContext,
} from '../../../../handlers/user-input/api';
import { resolveInterface, updateInterfaceIfExists } from '../../../../utils';
import type { ConfirmationInterfaceKey, FetchStatus } from '../../api';
import { isConfirmBlocked } from '../../utils';
import { renderConfirmationView } from '../render';

/**
 * Re-renders the interface with a patched context.
 *
 * @param id - The interface id.
 * @param context - The current interface context.
 * @param patch - The context fields to override.
 */
async function reRender(
  id: string,
  context: Record<string, Json>,
  patch: Record<string, Json>,
): Promise<void> {
  const nextContext = { ...context, ...patch };
  const interfaceKey = context.interfaceKey as ConfirmationInterfaceKey;
  await updateInterfaceIfExists(
    id,
    renderConfirmationView(interfaceKey, nextContext),
    nextContext,
  );
}

/**
 * Opens the malicious acknowledgement screen when the user clicks "Review alerts".
 *
 * @param options - The user input handler context.
 */
async function onReviewClick(
  options: UserInputUiEventHandlerContext,
): Promise<void> {
  const { id, context } = options;
  if (!context) {
    return;
  }
  await reRender(id, context, {
    acknowledgementScreen: true,
    acknowledged: false,
  });
}

/**
 * Tracks the risk-acknowledgement checkbox so the "Confirm" button can enable.
 *
 * @param options - The user input handler context.
 */
async function onAcknowledgeChange(
  options: UserInputUiEventHandlerContext,
): Promise<void> {
  const { id, event, context } = options;
  if (!context) {
    return;
  }
  const acknowledged = Boolean((event as InputChangeEvent).value);
  await reRender(id, context, { acknowledged });
}

/**
 * Confirms the transaction after the user acknowledged the malicious-scan risk.
 *
 * The proceed button is already disabled in the UI until the box is checked;
 * this re-checks `acknowledged` defensively so we never resolve the interface
 * for an unacknowledged risk.
 *
 * It also re-applies the confirmation footer's block guard: while the user was
 * on the acknowledgement screen, a background refresher may have invalidated the
 * transaction (failed re-validation) or left the scan pending. We never resolve
 * a transaction the footer would have blocked.
 *
 * @param options - The user input handler context.
 */
async function onProceedClick(
  options: UserInputUiEventHandlerContext,
): Promise<void> {
  const { id, context } = options;
  if (context?.acknowledged !== true) {
    return;
  }

  if (
    isConfirmBlocked({
      scanFetchStatus: context.scanFetchStatus as FetchStatus | undefined,
      transactionsFetchStatus: context.transactionsFetchStatus as
        | FetchStatus
        | undefined,
    })
  ) {
    return;
  }

  await resolveInterface(id, true);
}

/**
 * Returns from the acknowledgement screen to the confirmation view.
 *
 * @param options - The user input handler context.
 */
async function onBackClick(
  options: UserInputUiEventHandlerContext,
): Promise<void> {
  const { id, context } = options;
  if (!context) {
    return;
  }
  await reRender(id, context, {
    acknowledgementScreen: false,
    acknowledged: false,
  });
}

/**
 * Create the shared malicious-acknowledgement event handlers.
 *
 * @returns Object containing event handlers keyed by form element name.
 */
export function createEventHandlers(): Record<string, UserInputUiEventHandler> {
  return {
    [MaliciousAcknowledgementFormNames.Review]: onReviewClick,
    [MaliciousAcknowledgementFormNames.Acknowledge]: onAcknowledgeChange,
    [MaliciousAcknowledgementFormNames.Proceed]: onProceedClick,
    [MaliciousAcknowledgementFormNames.Back]: onBackClick,
  };
}
