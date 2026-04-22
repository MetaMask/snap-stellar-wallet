import type {
  UserInputUiEventHandler,
  UserInputUiEventHandlerContext,
} from '../../../../handlers/user-input/api';
import { resolveInterface } from '../../../../utils';

/**
 * Handles the click event for the cancel button.
 *
 * @param options - The user input handler context from `onUserInput`.
 * @returns A promise that resolves when the interface has been updated.
 */
async function onCancelButtonClick(
  options: UserInputUiEventHandlerContext,
): Promise<void> {
  const { id } = options;
  await resolveInterface(id, false);
}

/**
 * Handles the click event for the confirm button.
 *
 * @param options - The user input handler context from `onUserInput`.
 * @returns A promise that resolves when the interface has been updated.
 */
async function onConfirmButtonClick(
  options: UserInputUiEventHandlerContext,
): Promise<void> {
  const { id } = options;
  await resolveInterface(id, true);
}

export enum ConfirmSignChangeTrustOptOutFormNames {
  Cancel = 'confirm-sign-change-trust-opt-out-cancel',
  Confirm = 'confirm-sign-change-trust-opt-out-confirm',
}

/**
 * Create event handlers bound to a SnapClient instance.
 *
 * @returns Object containing event handlers.
 */
export function createEventHandlers(): Record<string, UserInputUiEventHandler> {
  return {
    [ConfirmSignChangeTrustOptOutFormNames.Cancel]: async (options) =>
      onCancelButtonClick(options),
    [ConfirmSignChangeTrustOptOutFormNames.Confirm]: async (options) =>
      onConfirmButtonClick(options),
  };
}
