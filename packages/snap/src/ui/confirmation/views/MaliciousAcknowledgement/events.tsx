import type { InputChangeEvent } from '@metamask/snaps-sdk';
import type { Json } from '@metamask/utils';

import { MaliciousAcknowledgementFormNames } from './constants';
import type {
  UserInputUiEventHandler,
  UserInputUiEventHandlerContext,
} from '../../../../handlers/user-input/api';
import { resolveInterface, updateInterfaceIfExists } from '../../../../utils';
import type { ConfirmationInterfaceKey } from '../../api';
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
 * @param options - The user input handler context.
 */
async function onProceedClick(
  options: UserInputUiEventHandlerContext,
): Promise<void> {
  await resolveInterface(options.id, true);
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
